// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getPreferencesStore browser fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("persists values to localStorage when Tauri is unavailable (browser renderer)", async () => {
    const { getPreferencesStore } = await import("./store");
    const store = await getPreferencesStore();
    expect(store).not.toBeNull();
    expect(store!.backend).toBe("browser");

    // Simulates the selected-workspace persistence path used on reopen.
    await store!.set("selected_logical_workspace_id", "workspace-abc");
    await store!.save();

    // Survives a fresh module load (the analog of a page reload) because the
    // value lives in localStorage, not module memory.
    vi.resetModules();
    const { getPreferencesStore: reloaded } = await import("./store");
    const restored = await (await reloaded())!.get<string>("selected_logical_workspace_id");
    expect(restored).toBe("workspace-abc");
  });

  it("returns undefined for unknown keys", async () => {
    const { getPreferencesStore } = await import("./store");
    const store = await getPreferencesStore();
    expect(await store!.get("never-set")).toBeUndefined();
  });

  it("deletes keys so ProductStorage.removeItem works in the browser renderer", async () => {
    const { getPreferencesStore } = await import("./store");
    const store = await getPreferencesStore();

    await store!.set("keep", "kept");
    await store!.set("drop", "dropped");

    // The main-branch product-storage adapter calls store.delete(key) from
    // removeItem; the browser fallback must support the same surface.
    expect(await store!.delete("drop")).toBe(true);
    expect(await store!.get("drop")).toBeUndefined();
    expect(await store!.get<string>("keep")).toBe("kept");

    // Deleting an absent key reports false rather than throwing.
    expect(await store!.delete("drop")).toBe(false);
  });

  it("keeps unrelated browser preferences best-effort when quota is unavailable", async () => {
    const { getPreferencesStore } = await import("./store");
    const store = await getPreferencesStore();
    await store!.set("ordinary-preference", "old-value");
    const quotaError = new DOMException("full", "QuotaExceededError");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaError;
    });

    await expect(store!.set("ordinary-preference", "value")).resolves.toBeUndefined();
    await expect(store!.delete("ordinary-preference")).resolves.toBe(false);

    setItem.mockRestore();
  });

  it("propagates strict nested V1 cleanup failure without deleting the raw recovery key", async () => {
    const key = "proliferate.supportReportJobs.v1";
    localStorage.setItem("proliferate.preferences", JSON.stringify({ [key]: "nested" }));
    localStorage.setItem(key, "raw");
    const { desktopProductStorage } = await import("../browser/product-storage");
    const quotaError = new DOMException("full", "QuotaExceededError");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaError;
    });

    await expect(desktopProductStorage.removeItem(key)).rejects.toBe(quotaError);
    expect(localStorage.getItem(key)).toBe("raw");

    setItem.mockRestore();
  });

  it("removes preferences through the ProductStorage adapter", async () => {
    const { desktopProductStorage } = await import("../browser/product-storage");

    await desktopProductStorage.setItem("pref-key", "pref-value");
    expect(await desktopProductStorage.getItem("pref-key")).toBe("pref-value");

    await desktopProductStorage.removeItem("pref-key");
    expect(await desktopProductStorage.getItem("pref-key")).toBeNull();
  });
});

describe("getPreferencesStore inside Tauri", () => {
  const tauriWindow = () => window as unknown as Record<string, unknown>;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    tauriWindow().__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete tauriWindow().__TAURI_INTERNALS__;
    vi.doUnmock("@tauri-apps/plugin-store");
  });

  it("does not cache the localStorage fallback after a transient plugin-store failure", async () => {
    const realStore = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
      save: vi.fn(async () => undefined),
    };
    let loadCalls = 0;
    vi.doMock("@tauri-apps/plugin-store", () => ({
      Store: {
        load: vi.fn(async () => {
          loadCalls += 1;
          if (loadCalls === 1) {
            throw new Error("transient module load failure");
          }
          return realStore;
        }),
      },
    }));

    const { getPreferencesStore } = await import("./store");

    // First call: the real store import fails transiently. We get a best-effort
    // fallback but it must NOT be cached, so a later call can recover.
    const first = await getPreferencesStore();
    expect(first).not.toBe(realStore);
    expect(first!.backend).toBe("tauri_fallback");

    // Second call retries the real Tauri store rather than serving a cached
    // fallback — real persistence recovers once the transient failure clears.
    const second = await getPreferencesStore();
    expect(second!.backend).toBe("tauri");
    await second!.set("preference", "value");
    expect(realStore.set).toHaveBeenCalledWith("preference", "value");
    expect(loadCalls).toBe(2);
  });

  it("recovers a raw V1 write after transient fallback and durably removes it", async () => {
    const key = "proliferate.supportReportJobs.v1";
    const value = '[{"job":{"jobId":"recoverable"}}]';
    const realStore = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
      save: vi.fn(async () => undefined),
    };
    let loadCalls = 0;
    vi.doMock("@tauri-apps/plugin-store", () => ({
      Store: {
        load: vi.fn(async () => {
          loadCalls += 1;
          if (loadCalls === 1) {
            throw new Error("transient module load failure");
          }
          return realStore;
        }),
      },
    }));
    const { desktopProductStorage } = await import("../browser/product-storage");

    await desktopProductStorage.setItem(key, value);
    expect(localStorage.getItem(key)).toBe(value);
    await expect(desktopProductStorage.getItem(key)).resolves.toBe(value);
    await desktopProductStorage.removeItem(key);

    expect(realStore.delete).toHaveBeenCalledWith(key);
    expect(realStore.save).toHaveBeenCalledOnce();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("blocks V1 hydration and cleanup until the real Tauri store recovers", async () => {
    const key = "proliferate.supportReportJobs.v1";
    const value = '[{"job":{"jobId":"must-not-disappear"}}]';
    localStorage.setItem("proliferate.preferences", JSON.stringify({ [key]: value }));
    localStorage.setItem(key, value);
    const realStore = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
      save: vi.fn(async () => undefined),
    };
    let loadCalls = 0;
    vi.doMock("@tauri-apps/plugin-store", () => ({
      Store: {
        load: vi.fn(async () => {
          loadCalls += 1;
          if (loadCalls <= 2) {
            throw new Error("transient module load failure");
          }
          return realStore;
        }),
      },
    }));
    const { desktopProductStorage } = await import("../browser/product-storage");

    await expect(desktopProductStorage.getItem(key)).rejects.toThrow(
      "Tauri preferences storage is temporarily unavailable.",
    );
    await expect(desktopProductStorage.removeItem(key)).rejects.toThrow(
      "Tauri preferences storage is temporarily unavailable.",
    );
    expect(localStorage.getItem(key)).toBe(value);
    expect(JSON.parse(localStorage.getItem("proliferate.preferences") ?? "{}")).toMatchObject({
      [key]: value,
    });

    await expect(desktopProductStorage.getItem(key)).resolves.toBe(value);
    await desktopProductStorage.removeItem(key);
    expect(realStore.save).toHaveBeenCalledOnce();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("recovers and removes a V1 value stranded in the old nested fallback", async () => {
    const key = "proliferate.supportReportJobs.v1";
    const value = '[{"job":{"jobId":"nested-recovery"}}]';
    localStorage.setItem("proliferate.preferences", JSON.stringify({ [key]: value }));
    const realStore = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
      save: vi.fn(async () => undefined),
    };
    vi.doMock("@tauri-apps/plugin-store", () => ({
      Store: { load: vi.fn(async () => realStore) },
    }));
    const { desktopProductStorage } = await import("../browser/product-storage");

    await expect(desktopProductStorage.getItem(key)).resolves.toBe(value);
    await desktopProductStorage.removeItem(key);

    expect(realStore.delete).toHaveBeenCalledWith(key);
    expect(realStore.save).toHaveBeenCalledOnce();
    expect(localStorage.getItem("proliferate.preferences")).toBe("{}");
  });
});
