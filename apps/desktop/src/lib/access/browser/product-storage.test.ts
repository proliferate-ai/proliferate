// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPreferencesStore = vi.fn();

vi.mock("@/lib/access/tauri/store", () => ({
  getPreferencesStore: () => getPreferencesStore(),
}));

import { desktopProductStorage } from "./product-storage";

interface FakeStore {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

function makeStore(overrides: Partial<FakeStore> = {}): FakeStore {
  return {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => true),
    save: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("desktopProductStorage (Tauri-store backed)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    getPreferencesStore.mockReset();
    vi.unstubAllGlobals();
  });

  it("getItem passes a string value through unchanged", async () => {
    const store = makeStore({ get: vi.fn(async () => "already-a-string") });
    getPreferencesStore.mockResolvedValue(store);

    const result = await desktopProductStorage.getItem("k");

    expect(result).toBe("already-a-string");
    expect(store.get).toHaveBeenCalledWith("k");
  });

  it("getItem normalizes a legacy raw-object value to a JSON string", async () => {
    const legacy = { theme: "dark", extras: { a: 1 } };
    const store = makeStore({ get: vi.fn(async () => legacy) });
    getPreferencesStore.mockResolvedValue(store);

    const result = await desktopProductStorage.getItem("user_preferences");

    expect(result).toBe(JSON.stringify(legacy));
  });

  it("getItem falls back to localStorage when the store is unavailable", async () => {
    getPreferencesStore.mockResolvedValue(null);
    window.localStorage.setItem("k", "browser-value");

    const result = await desktopProductStorage.getItem("k");

    expect(result).toBe("browser-value");
  });

  it("getItem reads through to localStorage on a store miss", async () => {
    const store = makeStore({ get: vi.fn(async () => undefined) });
    getPreferencesStore.mockResolvedValue(store);
    window.localStorage.setItem("proliferate.chatDiffPreferences.v1", "legacy-only");

    const result = await desktopProductStorage.getItem(
      "proliferate.chatDiffPreferences.v1",
    );

    expect(result).toBe("legacy-only");
  });

  it("setItem writes to the canonical Tauri store when available", async () => {
    const store = makeStore();
    getPreferencesStore.mockResolvedValue(store);

    await desktopProductStorage.setItem("k", "v");

    expect(store.set).toHaveBeenCalledWith("k", "v");
  });

  it("setItem falls back to localStorage when the store is unavailable", async () => {
    getPreferencesStore.mockResolvedValue(null);

    await desktopProductStorage.setItem("k", "v");

    expect(window.localStorage.getItem("k")).toBe("v");
  });

  it("removeItem deletes from the store and clears any read-through value", async () => {
    const store = makeStore();
    getPreferencesStore.mockResolvedValue(store);
    window.localStorage.setItem("k", "legacy");

    await desktopProductStorage.removeItem("k");

    expect(store.delete).toHaveBeenCalledWith("k");
    expect(window.localStorage.getItem("k")).toBeNull();
  });

  it("removeItem falls back to localStorage when the store is unavailable", async () => {
    getPreferencesStore.mockResolvedValue(null);
    window.localStorage.setItem("k", "legacy");

    await desktopProductStorage.removeItem("k");

    expect(window.localStorage.getItem("k")).toBeNull();
  });
});
