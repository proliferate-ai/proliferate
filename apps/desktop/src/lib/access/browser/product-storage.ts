import type { ProductStorage } from "@proliferate/product-client/host/product-host";

import { getPreferencesStore, type StoreInstance } from "@/lib/access/tauri/store";

const LEGACY_SUPPORT_REPORT_QUEUE_KEY = "proliferate.supportReportJobs.v1";
const DURABLE_SUPPORT_REPORT_QUEUE_KEYS = new Set([
  "proliferate.supportReportJobs.v2",
  "proliferate.supportReportJobs.v2.pending",
]);
const TAURI_STORE_RETRY_MESSAGE = "Tauri preferences storage is temporarily unavailable.";
const LEGACY_SUPPORT_REPORT_QUEUE_CONFLICT_MESSAGE =
  "Legacy support report queue copies conflict.";
const LEGACY_SUPPORT_REPORT_QUEUE_INVALID_MESSAGE =
  "Legacy support report queue contains a non-JSON value.";

interface LegacySupportReportQueueCopies {
  value: string | null;
  pluginValue: string | null;
  rawValue: string | null;
  nestedValue: string | null;
}

function isDurableSupportReportQueueKey(key: string): boolean {
  return DURABLE_SUPPORT_REPORT_QUEUE_KEYS.has(key);
}

function normalizeLegacySupportReportQueueValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error(LEGACY_SUPPORT_REPORT_QUEUE_INVALID_MESSAGE);
  }
  return serialized;
}

function resolveLegacySupportReportQueueValue(
  values: ReadonlyArray<string | null>,
): string | null {
  let resolved: string | null = null;
  for (const value of values) {
    if (value === null) {
      continue;
    }
    if (resolved !== null && resolved !== value) {
      throw new Error(LEGACY_SUPPORT_REPORT_QUEUE_CONFLICT_MESSAGE);
    }
    resolved = value;
  }
  return resolved;
}

async function readLegacySupportReportQueueCopies(
  store: StoreInstance,
): Promise<LegacySupportReportQueueCopies> {
  if (store.backend === "tauri_fallback") {
    // A plugin-backed V1 value may still exist. Missing fallback bytes cannot
    // prove an empty queue, so hydration must retry after plugin recovery.
    throw new Error(TAURI_STORE_RETRY_MESSAGE);
  }

  const pluginValue = normalizeLegacySupportReportQueueValue(
    store.backend === "tauri"
      ? await store.get<unknown>(LEGACY_SUPPORT_REPORT_QUEUE_KEY)
      : undefined,
  );
  const rawValue = window.localStorage.getItem(LEGACY_SUPPORT_REPORT_QUEUE_KEY);
  const nestedValue = normalizeLegacySupportReportQueueValue(
    await store.readBrowserFallbackStrict<unknown>(LEGACY_SUPPORT_REPORT_QUEUE_KEY),
  );

  return {
    value: resolveLegacySupportReportQueueValue([
      pluginValue,
      rawValue,
      nestedValue,
    ]),
    pluginValue,
    rawValue,
    nestedValue,
  };
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
    if (key === LEGACY_SUPPORT_REPORT_QUEUE_KEY) {
      const copies = await readLegacySupportReportQueueCopies(store);
      return copies.value;
    }
    const value = await store.get<unknown>(key);
    if (value === undefined || value === null) {
      return window.localStorage.getItem(key);
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
      const copies = await readLegacySupportReportQueueCopies(store);
      if (store.backend === "tauri") {
        if (
          copies.pluginValue !== null &&
          copies.rawValue === null &&
          copies.nestedValue === null
        ) {
          // Plugin deletion mutates the in-memory store before save flushes it.
          // Seed a strict raw recovery copy first so a failed save can be
          // retried in this process and safely reconciled after a restart.
          window.localStorage.setItem(key, copies.pluginValue);
        }
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
