import type { ProductStorage } from "@proliferate/product-client/host/product-host";

import { getPreferencesStore } from "@/lib/access/tauri/store";

const LEGACY_SUPPORT_REPORT_QUEUE_KEY = "proliferate.supportReportJobs.v1";
const DURABLE_SUPPORT_REPORT_QUEUE_KEYS = new Set([
  "proliferate.supportReportJobs.v2",
  "proliferate.supportReportJobs.v2.pending",
]);
const TAURI_STORE_RETRY_MESSAGE = "Tauri preferences storage is temporarily unavailable.";

function isDurableSupportReportQueueKey(key: string): boolean {
  return DURABLE_SUPPORT_REPORT_QUEUE_KEYS.has(key);
}

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
// The support-report V2 document and journal are deliberately different. They
// are independent raw localStorage entries so setItem completes synchronously,
// exact string bytes round-trip, and quota/access failures reach the queue
// controller. They never enter the shared browser preferences object or the
// Tauri store's debounced autosave path.
export const desktopProductStorage: ProductStorage = {
  async getItem(key: string): Promise<string | null> {
    if (isDurableSupportReportQueueKey(key)) {
      return window.localStorage.getItem(key);
    }

    const store = await getPreferencesStore();
    if (!store) {
      return window.localStorage.getItem(key);
    }
    if (key === LEGACY_SUPPORT_REPORT_QUEUE_KEY && store.backend === "tauri_fallback") {
      // A plugin-backed V1 value may still exist. Missing fallback bytes cannot
      // prove an empty queue, so hydration must retry after plugin recovery.
      throw new Error(TAURI_STORE_RETRY_MESSAGE);
    }
    if (key === LEGACY_SUPPORT_REPORT_QUEUE_KEY && store.backend === "browser") {
      const rawValue = window.localStorage.getItem(key);
      if (rawValue !== null) {
        return rawValue;
      }
    }
    const value = await store.get<unknown>(key);
    if (value === undefined || value === null) {
      // Store miss: prefer the raw recovery key used by current fallback
      // writes, then recover a pre-repair nested fallback value if one exists.
      const rawValue = window.localStorage.getItem(key);
      if (rawValue !== null || key !== LEGACY_SUPPORT_REPORT_QUEUE_KEY) {
        return rawValue;
      }
      const nestedValue = await store.readBrowserFallbackStrict<unknown>(key);
      if (nestedValue === undefined || nestedValue === null) {
        return null;
      }
      return typeof nestedValue === "string"
        ? nestedValue
        : JSON.stringify(nestedValue);
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  },

  async setItem(key: string, value: string): Promise<void> {
    if (isDurableSupportReportQueueKey(key)) {
      window.localStorage.setItem(key, value);
      return;
    }

    const store = await getPreferencesStore();
    if (!store) {
      window.localStorage.setItem(key, value);
      return;
    }
    if (key === LEGACY_SUPPORT_REPORT_QUEUE_KEY && store.backend !== "tauri") {
      // A transient Tauri plugin-load failure must not strand V1 inside the
      // shared browser-preferences object. Plugin recovery reads through this
      // exact raw key, so migration can still find and remove the legacy job.
      window.localStorage.setItem(key, value);
      return;
    }
    await store.set(key, value);
  },

  async removeItem(key: string): Promise<void> {
    if (isDurableSupportReportQueueKey(key)) {
      window.localStorage.removeItem(key);
      return;
    }

    const store = await getPreferencesStore();
    if (!store) {
      window.localStorage.removeItem(key);
      return;
    }
    if (key === LEGACY_SUPPORT_REPORT_QUEUE_KEY) {
      if (store.backend === "tauri_fallback") {
        // Neither fallback copy can prove that the plugin has no V1 value.
        // Keep every recovery copy and let migration retry after plugin load.
        throw new Error(TAURI_STORE_RETRY_MESSAGE);
      }
      if (store.backend === "tauri") {
        await store.delete(key);
        // Migration may remove V1 only after the plugin deletion is durably
        // flushed. If save rejects, retain the raw read-through copy so a later
        // hydration can recover and retry the cleanup.
        await store.save();
      }
      // Browser fallback normally keeps ordinary preference writes
      // best-effort. V1 migration is different: a pre-repair nested copy must
      // be removed with propagated read/quota errors before its raw recovery
      // copy is removed, including after the real plugin has recovered.
      await store.deleteBrowserFallbackStrict(key);
    } else {
      await store.delete(key);
    }
    // Also clear any read-through legacy value so a removal cannot be undone by
    // a stale browser-storage entry on the next read.
    window.localStorage.removeItem(key);
  },
};
