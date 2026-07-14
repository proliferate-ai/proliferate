// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

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
