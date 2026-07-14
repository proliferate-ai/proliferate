// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopProductStorage } from "./product-storage";

describe("desktopProductStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getItem returns the stored string value", async () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "test-value"),
    });

    const result = await desktopProductStorage.getItem("test-key");

    expect(result).toBe("test-value");
    expect(window.localStorage.getItem).toHaveBeenCalledWith("test-key");
  });

  it("getItem returns null when key does not exist", async () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
    });

    const result = await desktopProductStorage.getItem("nonexistent-key");

    expect(result).toBeNull();
    expect(window.localStorage.getItem).toHaveBeenCalledWith("nonexistent-key");
  });

  it("setItem writes the value to localStorage", async () => {
    const setItemMock = vi.fn();
    vi.stubGlobal("localStorage", {
      setItem: setItemMock,
    });

    await desktopProductStorage.setItem("test-key", "test-value");

    expect(setItemMock).toHaveBeenCalledWith("test-key", "test-value");
  });

  it("removeItem removes the key from localStorage", async () => {
    const removeItemMock = vi.fn();
    vi.stubGlobal("localStorage", {
      removeItem: removeItemMock,
    });

    await desktopProductStorage.removeItem("test-key");

    expect(removeItemMock).toHaveBeenCalledWith("test-key");
  });

  it("getItem rejects when localStorage throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => {
        throw new Error("Storage quota exceeded");
      }),
    });

    await expect(desktopProductStorage.getItem("test-key")).rejects.toThrow(
      "Storage quota exceeded"
    );
  });

  it("setItem rejects when localStorage throws", async () => {
    vi.stubGlobal("localStorage", {
      setItem: vi.fn(() => {
        throw new Error("Storage quota exceeded");
      }),
    });

    await expect(
      desktopProductStorage.setItem("test-key", "test-value")
    ).rejects.toThrow("Storage quota exceeded");
  });

  it("removeItem rejects when localStorage throws", async () => {
    vi.stubGlobal("localStorage", {
      removeItem: vi.fn(() => {
        throw new Error("Storage quota exceeded");
      }),
    });

    await expect(desktopProductStorage.removeItem("test-key")).rejects.toThrow(
      "Storage quota exceeded"
    );
  });

});
