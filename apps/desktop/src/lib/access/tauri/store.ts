type StoreInstance = {
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  save: () => Promise<void>;
};

let _store: StoreInstance | null = null;

export async function getPreferencesStore(): Promise<StoreInstance | null> {
  if (_store) return _store;
  try {
    const mod = await import("@tauri-apps/plugin-store");
    _store = await mod.Store.load("preferences.json", {
      autoSave: true,
      defaults: {},
    });
    return _store;
  } catch {
    // Outside Tauri (dev browser), persistence is unavailable.
    return null;
  }
}

export type { StoreInstance };
