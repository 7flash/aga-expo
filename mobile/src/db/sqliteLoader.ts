// Web/default SQLite loader.
// Keep this file free of any `expo-sqlite` import. Expo web currently attempts
// to bundle expo-sqlite's WASM worker when the package is referenced from the
// web graph, which can break boot before AGA can show logs. Native builds use
// sqliteLoader.native.ts instead.
export type AgaKvDatabase = any;

export async function openAgaKvDatabase(_name: string): Promise<AgaKvDatabase | null> {
  return null;
}
