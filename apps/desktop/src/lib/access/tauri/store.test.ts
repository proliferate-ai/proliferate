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

    // Second call retries the real Tauri store rather than serving a cached
    // fallback — real persistence recovers once the transient failure clears.
    const second = await getPreferencesStore();
    expect(second).toBe(realStore);
    expect(loadCalls).toBe(2);
  });
});
