import type { Reminder } from '../db/schema';

type NotificationModule = {
  requestPermissionsAsync?: () => Promise<{ status?: string; granted?: boolean }>;
  getPermissionsAsync?: () => Promise<{ status?: string; granted?: boolean }>;
  scheduleNotificationAsync?: (input: unknown) => Promise<string>;
  cancelScheduledNotificationAsync?: (id: string) => Promise<void>;
  setNotificationHandler?: (handler: unknown) => void;
};

let cached: Promise<NotificationModule | null> | null = null;
let handlerConfigured = false;

async function loadNotifications(): Promise<NotificationModule | null> {
  if (!cached) {
    cached = import('expo-notifications')
      .then((mod) => mod as unknown as NotificationModule)
      .catch(() => null);
  }
  return cached;
}

async function ensureHandler(module: NotificationModule) {
  if (handlerConfigured || !module.setNotificationHandler) return;
  module.setNotificationHandler({
    handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  handlerConfigured = true;
}

export async function notificationDiagnostics() {
  const module = await loadNotifications();
  if (!module) return { available: false, granted: false, status: 'module-missing' };
  const permissions = module.getPermissionsAsync ? await module.getPermissionsAsync() : null;
  return {
    available: true,
    granted: Boolean(permissions?.granted || permissions?.status === 'granted'),
    status: permissions?.status ?? 'unknown',
  };
}

export async function requestNotificationPermission() {
  const module = await loadNotifications();
  if (!module) return { available: false, granted: false, status: 'module-missing' };
  await ensureHandler(module);
  const current = module.getPermissionsAsync ? await module.getPermissionsAsync() : null;
  if (current?.granted || current?.status === 'granted') return { available: true, granted: true, status: 'granted' };
  const requested = module.requestPermissionsAsync ? await module.requestPermissionsAsync() : null;
  return {
    available: true,
    granted: Boolean(requested?.granted || requested?.status === 'granted'),
    status: requested?.status ?? 'unknown',
  };
}

export async function scheduleReminderNotification(reminder: Pick<Reminder, 'title' | 'dueAt'>) {
  const module = await loadNotifications();
  if (!module?.scheduleNotificationAsync) return null;
  await ensureHandler(module);
  const dueAt = new Date(reminder.dueAt);
  if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= Date.now()) return null;

  return module.scheduleNotificationAsync({
    content: {
      title: 'AGA reminder',
      body: reminder.title,
      sound: true,
      data: { kind: 'aga-reminder', dueAt: reminder.dueAt },
    },
    trigger: dueAt,
  });
}

export async function cancelReminderNotification(notificationId?: string | null) {
  if (!notificationId) return;
  const module = await loadNotifications();
  if (!module?.cancelScheduledNotificationAsync) return;
  await module.cancelScheduledNotificationAsync(notificationId);
}
