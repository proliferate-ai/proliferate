import { getPreferencesStore } from "@/lib/access/tauri/store";

export async function readPersistedValue<T>(key: string): Promise<T | undefined> {
  try {
    const store = await getPreferencesStore();
    if (!store) return undefined;
    return await store.get<T>(key);
  } catch {
    return undefined;
  }
}

export async function persistValue(key: string, value: unknown): Promise<void> {
  try {
    const store = await getPreferencesStore();
    if (!store) return;
    await store.set(key, value);
  } catch {
    // Platform unavailable outside Tauri
  }
}
