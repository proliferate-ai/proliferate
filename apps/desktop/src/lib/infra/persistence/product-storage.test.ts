import { describe, expect, it, vi } from "vitest";
import type { ProductStorage } from "@proliferate/product-client/host/product-host";

import {
  ProductStorageOperationError,
  readProductStorageJson,
  readProductStorageText,
  removeProductStorageItem,
  writeProductStorageJson,
  writeProductStorageText,
  type ProductStorageContext,
} from "./product-storage";

function makeContext(values = new Map<string, string>()): {
  context: ProductStorageContext;
  storage: ProductStorage;
  captureException: ReturnType<typeof vi.fn>;
} {
  const storage: ProductStorage = {
    getItem: vi.fn(async (key) => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => {
      values.set(key, value);
    }),
    removeItem: vi.fn(async (key) => {
      values.delete(key);
    }),
  };
  const captureException = vi.fn();
  return {
    context: { storage, captureException },
    storage,
    captureException,
  };
}

describe("product storage", () => {
  it("delegates exact text, JSON, and removal operations", async () => {
    const values = new Map<string, string>([["raw", "ship"]]);
    const { context, storage } = makeContext(values);

    await expect(readProductStorageText(context, "raw")).resolves.toBe("ship");
    await expect(writeProductStorageJson(context, "record", { enabled: true }))
      .resolves.toBe(true);
    await expect(writeProductStorageText(context, "plain", "1"))
      .resolves.toBe(true);
    await expect(readProductStorageJson(context, "record"))
      .resolves.toEqual({ enabled: true });
    await expect(removeProductStorageItem(context, "record")).resolves.toBe(true);

    expect(storage.setItem).toHaveBeenCalledWith(
      "record",
      JSON.stringify({ enabled: true }),
    );
    expect(storage.setItem).toHaveBeenCalledWith("plain", "1");
    expect(storage.removeItem).toHaveBeenCalledWith("record");
  });

  it("returns undefined for missing and malformed values", async () => {
    const values = new Map<string, string>([["broken", "{"]]);
    const { context, captureException } = makeContext(values);

    await expect(readProductStorageJson(context, "missing")).resolves.toBeUndefined();
    await expect(readProductStorageJson(context, "broken")).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException.mock.calls[0]?.[0]).toMatchObject({
      name: "ProductStorageOperationError",
      operation: "parse",
      key: "broken",
    });
  });

  it("captures rejected reads without rejecting hydration", async () => {
    const { context, storage, captureException } = makeContext();
    vi.mocked(storage.getItem).mockRejectedValueOnce(new Error("unavailable"));

    await expect(readProductStorageJson(context, "preferences")).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException.mock.calls[0]?.[0]).toBeInstanceOf(
      ProductStorageOperationError,
    );
  });

  it("settles writes and removals when capture itself throws or rejects", async () => {
    const { context, storage, captureException } = makeContext();
    vi.mocked(storage.setItem)
      .mockRejectedValueOnce(new Error("quota"))
      .mockResolvedValueOnce(undefined);
    vi.mocked(storage.removeItem).mockRejectedValueOnce(new Error("disabled"));
    captureException
      .mockImplementationOnce(() => {
        throw new Error("telemetry down");
      })
      .mockRejectedValueOnce(new Error("telemetry down"));

    await expect(writeProductStorageJson(context, "key", { pass: 1 }))
      .resolves.toBe(false);
    await expect(removeProductStorageItem(context, "key")).resolves.toBe(false);
    await expect(writeProductStorageJson(context, "key", { pass: 2 }))
      .resolves.toBe(true);

    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });
});
