// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPreferencesStore = vi.fn();

vi.mock("@/lib/access/tauri/store", () => ({
  getPreferencesStore: () => getPreferencesStore(),
}));

import { desktopProductStorage } from "./product-storage";

interface FakeStore {
  backend: "browser" | "tauri" | "tauri_fallback";
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  readBrowserFallbackStrict: ReturnType<typeof vi.fn>;
  deleteBrowserFallbackStrict: ReturnType<typeof vi.fn>;
}

function makeStore(overrides: Partial<FakeStore> = {}): FakeStore {
  return {
    backend: "tauri",
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => true),
    save: vi.fn(async () => {}),
    readBrowserFallbackStrict: vi.fn(async () => undefined),
    deleteBrowserFallbackStrict: vi.fn(async () => true),
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

  it("routes the V2 document and journal to independent exact raw entries", async () => {
    const store = makeStore();
    getPreferencesStore.mockResolvedValue(store);
    const document = '{"revision":1,"marker":"document"}';
    const journal = '{"target":{"revision":2},"marker":"journal"}';

    await desktopProductStorage.setItem("proliferate.supportReportJobs.v2", document);
    await desktopProductStorage.setItem(
      "proliferate.supportReportJobs.v2.pending",
      journal,
    );

    expect(await desktopProductStorage.getItem("proliferate.supportReportJobs.v2")).toBe(
      document,
    );
    expect(
      await desktopProductStorage.getItem("proliferate.supportReportJobs.v2.pending"),
    ).toBe(journal);
    expect(store.get).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    expect(getPreferencesStore).not.toHaveBeenCalled();

    await desktopProductStorage.removeItem("proliferate.supportReportJobs.v2.pending");

    expect(window.localStorage.getItem("proliferate.supportReportJobs.v2.pending")).toBeNull();
    expect(window.localStorage.getItem("proliferate.supportReportJobs.v2")).toBe(document);
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("propagates raw V2 quota and access errors", async () => {
    const quotaError = new DOMException("queue full", "QuotaExceededError");
    const accessError = new DOMException("storage disabled", "SecurityError");
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw quotaError;
      });

    await expect(
      desktopProductStorage.setItem("proliferate.supportReportJobs.v2", "exact bytes"),
    ).rejects.toBe(quotaError);

    setItem.mockRestore();
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => {
      throw accessError;
    });

    await expect(
      desktopProductStorage.getItem("proliferate.supportReportJobs.v2.pending"),
    ).rejects.toBe(accessError);

    getItem.mockRestore();
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => {
      throw accessError;
    });

    await expect(
      desktopProductStorage.removeItem("proliferate.supportReportJobs.v2"),
    ).rejects.toBe(accessError);
    removeItem.mockRestore();
    expect(getPreferencesStore).not.toHaveBeenCalled();
  });

  it("removeItem deletes from the store and clears any read-through value", async () => {
    const store = makeStore();
    getPreferencesStore.mockResolvedValue(store);
    window.localStorage.setItem("k", "legacy");

    await desktopProductStorage.removeItem("k");

    expect(store.delete).toHaveBeenCalledWith("k");
    expect(window.localStorage.getItem("k")).toBeNull();
  });

  it("flushes a legacy V1 plugin deletion before clearing its raw recovery copy", async () => {
    const store = makeStore();
    getPreferencesStore.mockResolvedValue(store);
    const key = "proliferate.supportReportJobs.v1";
    window.localStorage.setItem(key, "legacy");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");

    await desktopProductStorage.removeItem(key);

    expect(store.delete).toHaveBeenCalledWith(key);
    expect(store.delete.mock.invocationCallOrder[0]).toBeLessThan(
      store.save.mock.invocationCallOrder[0],
    );
    expect(store.save.mock.invocationCallOrder[0]).toBeLessThan(
      store.deleteBrowserFallbackStrict.mock.invocationCallOrder[0],
    );
    expect(store.deleteBrowserFallbackStrict.mock.invocationCallOrder[0]).toBeLessThan(
      removeItem.mock.invocationCallOrder[0],
    );
    expect(window.localStorage.getItem(key)).toBeNull();
    removeItem.mockRestore();
  });

  it("retains the legacy V1 raw recovery copy when plugin save rejects", async () => {
    const saveError = new Error("disk unavailable");
    const store = makeStore({ save: vi.fn().mockRejectedValueOnce(saveError) });
    getPreferencesStore.mockResolvedValue(store);
    const key = "proliferate.supportReportJobs.v1";
    window.localStorage.setItem(key, "legacy");

    await expect(desktopProductStorage.removeItem(key)).rejects.toBe(saveError);
    expect(window.localStorage.getItem(key)).toBe("legacy");
    expect(store.deleteBrowserFallbackStrict).not.toHaveBeenCalled();

    store.save.mockResolvedValueOnce(undefined);
    await desktopProductStorage.removeItem(key);
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(store.delete).toHaveBeenCalledTimes(2);
  });

  it("reads a legacy V1 raw recovery copy after a plugin miss", async () => {
    const store = makeStore({ get: vi.fn(async () => undefined) });
    getPreferencesStore.mockResolvedValue(store);
    const key = "proliferate.supportReportJobs.v1";
    window.localStorage.setItem(key, "legacy-raw");

    await expect(desktopProductStorage.getItem(key)).resolves.toBe("legacy-raw");
    expect(store.get).toHaveBeenCalledWith(key);
  });

  it("keeps browser-fallback deletion behavior for legacy V1 nested and raw copies", async () => {
    const store = makeStore({ backend: "browser" });
    getPreferencesStore.mockResolvedValue(store);
    const key = "proliferate.supportReportJobs.v1";
    window.localStorage.setItem(key, "legacy-raw");

    await desktopProductStorage.removeItem(key);

    expect(store.deleteBrowserFallbackStrict).toHaveBeenCalledWith(key);
    expect(store.delete).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("routes V1 fallback writes to the raw key so plugin recovery can read them", async () => {
    const browserStore = makeStore({ backend: "browser" });
    const tauriStore = makeStore({ get: vi.fn(async () => undefined) });
    getPreferencesStore
      .mockResolvedValueOnce(browserStore)
      .mockResolvedValueOnce(tauriStore);
    const key = "proliferate.supportReportJobs.v1";
    const value = '[{"job":{"jobId":"recoverable"}}]';

    await desktopProductStorage.setItem(key, value);

    expect(window.localStorage.getItem(key)).toBe(value);
    expect(browserStore.set).not.toHaveBeenCalled();
    await expect(desktopProductStorage.getItem(key)).resolves.toBe(value);
    expect(tauriStore.get).toHaveBeenCalledWith(key);
  });

  it("recovers and removes a pre-repair nested V1 value after plugin recovery", async () => {
    const key = "proliferate.supportReportJobs.v1";
    const nested = '[{"job":{"jobId":"nested-recovery"}}]';
    const store = makeStore({
      get: vi.fn(async () => undefined),
      readBrowserFallbackStrict: vi.fn(async () => nested),
    });
    getPreferencesStore.mockResolvedValue(store);

    await expect(desktopProductStorage.getItem(key)).resolves.toBe(nested);
    await desktopProductStorage.removeItem(key);

    expect(store.delete).toHaveBeenCalledWith(key);
    expect(store.save).toHaveBeenCalledOnce();
    expect(store.deleteBrowserFallbackStrict).toHaveBeenCalledWith(key);
  });

  it("removeItem falls back to localStorage when the store is unavailable", async () => {
    getPreferencesStore.mockResolvedValue(null);
    window.localStorage.setItem("k", "legacy");

    await desktopProductStorage.removeItem("k");

    expect(window.localStorage.getItem("k")).toBeNull();
  });
});
