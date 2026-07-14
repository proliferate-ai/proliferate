type StoreInstance = {
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  save: () => Promise<void>;
};

let _store: StoreInstance | null = null;

const BROWSER_STORE_KEY = "proliferate.preferences";

/**
 * localStorage-backed fallback for the preferences store when running as the
 * browser-rendered Desktop product (no Tauri). Without it, preferences — most
 * importantly the selected logical workspace — do not survive a reload, so the
 * product cannot reopen the last workspace/session. Keeps parity with the
 * packaged desktop's Tauri store (same get/set/save surface). Values are held
 * as one JSON object under a single localStorage key.
 */
function createBrowserPreferencesStore(): StoreInstance | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const readAll = (): Record<string, unknown> => {
    try {
      const raw = localStorage.getItem(BROWSER_STORE_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  return {
    get: async <T>(key: string): Promise<T | undefined> => {
      const all = readAll();
      return Object.prototype.hasOwnProperty.call(all, key) ? (all[key] as T) : undefined;
    },
    set: async (key: string, value: unknown): Promise<void> => {
      try {
        const all = readAll();
        all[key] = value;
        localStorage.setItem(BROWSER_STORE_KEY, JSON.stringify(all));
      } catch {
        // Storage unavailable/quota exceeded — persistence is best-effort.
      }
    },
    save: async (): Promise<void> => {
      // Writes are synchronous in `set`; nothing to flush.
    },
  };
}

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
    // Outside Tauri (browser-rendered Desktop): fall back to localStorage so
    // preferences (incl. the selected workspace) still persist across reloads.
    _store = createBrowserPreferencesStore();
    return _store;
  }
}

export type { StoreInstance };
