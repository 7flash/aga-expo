import { Platform } from 'react-native';

type NotificationsModule = any;

const CHANNEL_ID = 'aga-reminders';
let cached: NotificationsModule | null | undefined;
let handlerConfigured = false;
let channelConfigured = false;

function load(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('expo-notifications');
  } catch {
    cached = null;
  }
  return cached;
}

export function isNotificationsAvailable() {
  return !!load();
}

/** Call once on app start so foreground notifications surface a banner/list item. */
export function configureNotificationHandler() {
  const N = load();
  if (!N || handlerConfigured || !N.setNotificationHandler) return;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        // Older Expo SDK compatibility:
        shouldShowAlert: true,
      }),
    });
    handlerConfigured = true;
  } catch {
    // Keep AGA bootable even if the native module is missing or unavailable.
  }
}

async function configureAndroidChannel() {
  const N = load();
  if (Platform.OS !== 'android' || channelConfigured || !N?.setNotificationChannelAsync) return;
  try {
    await N.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'AGA reminders',
      importance: N.AndroidImportance?.HIGH ?? 4,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
    channelConfigured = true;
  } catch {
    // ignore; notification scheduling can still fail safely below
  }
}

export type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export async function getNotificationPermission(): Promise<NotificationPermission> {
  const N = load();
  if (!N?.getPermissionsAsync) return 'unavailable';
  try {
    const result = await N.getPermissionsAsync();
    if (result?.granted || result?.status === 'granted') return 'granted';
    return (result?.status as NotificationPermission) ?? 'undetermined';
  } catch {
    return 'unavailable';
  }
}

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  const N = load();
  if (!N?.requestPermissionsAsync || !N?.getPermissionsAsync) return 'unavailable';
  try {
    await configureAndroidChannel();
    const existing = await N.getPermissionsAsync();
    if (existing?.granted || existing?.status === 'granted') return 'granted';
    const requested = await N.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    if (requested?.granted || requested?.status === 'granted') return 'granted';
    return (requested?.status as NotificationPermission) ?? 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function scheduleAgaReminderNotification(input: {
  title?: string;
  body: string;
  dueAt: string | Date;
  data?: Record<string, unknown>;
}): Promise<string | null> {
  const N = load();
  if (!N?.scheduleNotificationAsync) return null;
  try {
    const permission = await ensureNotificationPermission();
    if (permission !== 'granted') return null;

    const date = input.dueAt instanceof Date ? input.dueAt : new Date(input.dueAt);
    if (Number.isNaN(date.getTime())) return null;
    const fireAt = date.getTime() <= Date.now() ? new Date(Date.now() + 4000) : date;
    const triggerType = N.SchedulableTriggerInputTypes?.DATE ?? 'date';

    return await N.scheduleNotificationAsync({
      content: {
        title: input.title ?? 'AGA reminder',
        body: input.body,
        sound: 'default',
        data: input.data,
      },
      trigger: {
        type: triggerType,
        date: fireAt,
        channelId: CHANNEL_ID,
      } as any,
    });
  } catch {
    return null;
  }
}

// Compatibility with the version you shared.
export async function scheduleReminderNotification(title: string, dueAt: string): Promise<string | null> {
  return scheduleAgaReminderNotification({ title: 'AGA reminder', body: title, dueAt });
}

export async function cancelAgaNotification(id: string | null | undefined) {
  const N = load();
  if (!N?.cancelScheduledNotificationAsync || !id) return;
  try {
    await N.cancelScheduledNotificationAsync(id);
  } catch {
    // ignore
  }
}

export async function cancelNotification(id: string | null | undefined) {
  return cancelAgaNotification(id);
}

export async function cancelAllAgaNotifications() {
  const N = load();
  if (!N?.cancelAllScheduledNotificationsAsync) return;
  try {
    await N.cancelAllScheduledNotificationsAsync();
  } catch {
    // ignore
  }
}

export async function cancelAllNotifications() {
  return cancelAllAgaNotifications();
}
