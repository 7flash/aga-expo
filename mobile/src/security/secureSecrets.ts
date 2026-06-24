declare const require: any;

type SecureStoreModule = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

let cachedSecureStore: SecureStoreModule | null | undefined;

function loadSecureStore(): SecureStoreModule | null {
  if (cachedSecureStore !== undefined) return cachedSecureStore;
  try {
    cachedSecureStore = require('expo-secure-store') as SecureStoreModule;
  } catch {
    cachedSecureStore = null;
  }
  return cachedSecureStore;
}

export function isSecureStoreAvailable() {
  return !!loadSecureStore();
}

export async function getSecret(key: string) {
  const store = loadSecureStore();
  if (!store) return null;
  try {
    return await store.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setSecret(key: string, value: string | null | undefined) {
  const store = loadSecureStore();
  if (!store) return false;
  try {
    const clean = value?.trim();
    if (clean) await store.setItemAsync(key, clean);
    else await store.deleteItemAsync(key);
    return true;
  } catch {
    return false;
  }
}

export const SECRET_KEYS = {
  openaiApiKey: 'aga.openaiApiKey',
  geminiApiKey: 'aga.geminiApiKey',
  remoteBackendToken: 'aga.remoteBackendToken',
} as const;
