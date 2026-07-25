import { describe, expect, it, vi } from "vitest";

import {
  getLocalAutomationExecutorId,
  getProductStorageLocalAutomationExecutorId,
  type LocalAutomationExecutorIdCache,
} from "@/lib/workflows/automations/local-automation-executor-identity";

describe("getLocalAutomationExecutorId", () => {
  it("replaces wrong-shaped persisted JSON with a generated executor id", async () => {
    const cache: LocalAutomationExecutorIdCache = { current: null };
    const persistId = vi.fn(async () => undefined);

    await expect(getLocalAutomationExecutorId(cache, {
      readPersistedId: async () => ({ unexpected: true }),
      persistId,
      createId: () => "generated-id",
    })).resolves.toBe("desktop:generated-id");

    expect(persistId).toHaveBeenCalledWith("desktop:generated-id");
  });

  it("clears a rejected cached lookup so the next attempt can recover", async () => {
    const cache: LocalAutomationExecutorIdCache = { current: null };
    const readPersistedId = vi.fn()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValueOnce(" desktop:recovered ");

    await expect(getLocalAutomationExecutorId(cache, {
      readPersistedId,
      persistId: vi.fn(async () => undefined),
      createId: () => "unused",
    })).rejects.toThrow("read failed");
    expect(cache.current).toBeNull();

    await expect(getLocalAutomationExecutorId(cache, {
      readPersistedId,
      persistId: vi.fn(async () => undefined),
      createId: () => "unused",
    })).resolves.toBe("desktop:recovered");
    expect(readPersistedId).toHaveBeenCalledTimes(2);
  });

  it("delegates the exact executor key and JSON value to ProductStorage", async () => {
    const getItem = vi.fn(async () => null);
    const setItem = vi.fn(async () => undefined);
    const context = {
      storage: {
        getItem,
        setItem,
        removeItem: vi.fn(async () => undefined),
      },
      captureException: vi.fn(),
    };

    await expect(getProductStorageLocalAutomationExecutorId(
      context,
      { current: null },
      () => "generated-id",
    )).resolves.toBe("desktop:generated-id");

    expect(getItem).toHaveBeenCalledWith("automationLocalExecutorId");
    expect(setItem).toHaveBeenCalledWith(
      "automationLocalExecutorId",
      JSON.stringify("desktop:generated-id"),
    );
  });

  it("caches the generated id when the ProductStorage write fails", async () => {
    const cache: LocalAutomationExecutorIdCache = { current: null };
    const getItem = vi.fn(async () => null);
    const setItem = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    const createId = vi.fn(() => "generated-id");
    const context = {
      storage: {
        getItem,
        setItem,
        removeItem: vi.fn(async () => undefined),
      },
      captureException: vi.fn(),
    };

    await expect(getProductStorageLocalAutomationExecutorId(
      context,
      cache,
      createId,
    )).resolves.toBe("desktop:generated-id");

    await expect(getProductStorageLocalAutomationExecutorId(
      context,
      cache,
      createId,
    )).resolves.toBe("desktop:generated-id");
    expect(getItem).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith(
      "automationLocalExecutorId",
      JSON.stringify("desktop:generated-id"),
    );
    expect(createId).toHaveBeenCalledOnce();
  });
});
