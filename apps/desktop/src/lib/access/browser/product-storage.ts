import type { ProductStorage } from "@proliferate/product-client/host/product-host";

import { getPreferencesStore } from "@/lib/access/tauri/store";

// ProductStorage backed by the Desktop Tauri preferences store — the same
// `preferences.json` backend that user/repo/workspace/session preferences
// already persist to. Backing the host storage capability on that store (rather
// than raw localStorage) lets existing product state hydrate through the host
// with zero migration once callers move onto it.
//
// Backend selection:
// - Reads: prefer the Tauri store; normalize legacy raw-object values (written
//   before this capability existed via `persistValue(key, object)`) into JSON
//   strings so the JSON helper can parse them. On a store miss, read through to
//   `window.localStorage` so keys that historically lived only in browser
//   storage still hydrate.
// - Writes: always target the canonical Tauri store when available.
// - Outside Tauri (the store fails to load) every operation falls back to
//   `window.localStorage`, matching the prior adapter behavior.
//
// Browser storage exceptions (quota, disabled storage) reject the returned
// promise instead of throwing synchronously; the injected product-storage
// helper captures them.
export const desktopProductStorage: ProductStorage = {
  async getItem(key: string): Promise<string | null> {
    const store = await getPreferencesStore();
    if (!store) {
      return window.localStorage.getItem(key);
    }
    const value = await store.get<unknown>(key);
    if (value === undefined || value === null) {
      // Store miss: read through to any legacy browser-storage value.
      return window.localStorage.getItem(key);
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  },

  async setItem(key: string, value: string): Promise<void> {
    const store = await getPreferencesStore();
    if (!store) {
      window.localStorage.setItem(key, value);
      return;
    }
    await store.set(key, value);
  },

  async removeItem(key: string): Promise<void> {
    const store = await getPreferencesStore();
    if (!store) {
      window.localStorage.removeItem(key);
      return;
    }
    await store.delete(key);
    // Also clear any read-through legacy value so a removal cannot be undone by
    // a stale browser-storage entry on the next read.
    window.localStorage.removeItem(key);
  },
};
