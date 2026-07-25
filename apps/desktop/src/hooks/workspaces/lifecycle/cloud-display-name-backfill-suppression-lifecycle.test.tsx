// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";

import {
  clearCloudDisplayNameBackfillSuppression,
  isCloudDisplayNameBackfillSuppressed,
  resetCloudDisplayNameBackfillSuppressionForTests,
  suppressCloudDisplayNameBackfill,
  useCloudDisplayNameBackfillSuppressionAuthority,
  useCloudDisplayNameBackfillSuppressionLifecycle,
} from "./cloud-display-name-backfill-suppression";

const persistenceMocks = vi.hoisted(() => ({
  currentContext: undefined as unknown as ProductStorageContext,
}));

vi.mock("@/hooks/app/facade/use-product-storage-context", () => ({
  useProductStorageContext: () => persistenceMocks.currentContext,
}));

beforeEach(() => {
  cleanup();
  resetCloudDisplayNameBackfillSuppressionForTests();
});

afterEach(cleanup);

describe("Cloud display-name backfill suppression lifecycle", () => {
  it("keeps the whole live suppression record when it changes during hydration", async () => {
    const storage = createStorageHarness();
    persistenceMocks.currentContext = storage.context;
    let resolveRead: (value: string | null) => void = () => undefined;
    storage.getItem.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));

    const authority = renderSuppressionAuthority();
    act(() => {
      suppressCloudDisplayNameBackfill("cloud-live");
      clearCloudDisplayNameBackfillSuppression("cloud-persisted-clear");
    });
    await act(async () => resolveRead(JSON.stringify({
      "cloud-persisted-sibling": true,
      "cloud-persisted-clear": true,
    })));
    await waitFor(() => expect(authority.result.current.hydrated).toBe(true));

    expect(isCloudDisplayNameBackfillSuppressed("cloud-persisted-sibling")).toBe(false);
    expect(isCloudDisplayNameBackfillSuppressed("cloud-live")).toBe(true);
    expect(isCloudDisplayNameBackfillSuppressed("cloud-persisted-clear")).toBe(false);
    await waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(1));
    expect(JSON.parse(storage.values.get(SUPPRESSION_KEY)!)).toEqual({
      "cloud-live": true,
    });
  });

  it.each(["rejected", "malformed", "missing"] as const)(
    "stays fail closed until a %s read settles",
    async (result) => {
      const storage = createStorageHarness();
      persistenceMocks.currentContext = storage.context;
      let settleRead: () => void = () => undefined;
      storage.getItem.mockReturnValueOnce(new Promise((resolve, reject) => {
        settleRead = () => {
          if (result === "rejected") {
            reject(new Error("storage unavailable"));
          } else {
            resolve(result === "malformed" ? "{" : null);
          }
        };
      }));

      const authority = renderSuppressionAuthority();
      expect(authority.result.current.hydrated).toBe(false);
      await act(async () => settleRead());
      await waitFor(() => expect(authority.result.current.hydrated).toBe(true));

      expect(isCloudDisplayNameBackfillSuppressed("cloud-a")).toBe(false);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      if (result === "missing") {
        expect(storage.captureException).not.toHaveBeenCalled();
      } else {
        expect(storage.captureException).toHaveBeenCalled();
      }
    },
  );

  it("ignores a stale read after storage replacement", async () => {
    const firstStorage = createStorageHarness();
    let resolveFirstRead: (value: string | null) => void = () => undefined;
    firstStorage.getItem.mockReturnValueOnce(new Promise((resolve) => {
      resolveFirstRead = resolve;
    }));
    persistenceMocks.currentContext = firstStorage.context;
    const authority = renderSuppressionAuthority();
    expect(authority.result.current.hydrated).toBe(false);

    const secondStorage = createStorageHarness({ "cloud-b": true });
    persistenceMocks.currentContext = secondStorage.context;
    authority.rerender();
    expect(authority.result.current.hydrated).toBe(false);
    await waitFor(() => expect(authority.result.current.hydrated).toBe(true));
    expect(isCloudDisplayNameBackfillSuppressed("cloud-b")).toBe(true);

    await act(async () => resolveFirstRead(JSON.stringify({ "cloud-a": true })));
    expect(isCloudDisplayNameBackfillSuppressed("cloud-a")).toBe(false);
    expect(isCloudDisplayNameBackfillSuppressed("cloud-b")).toBe(true);
    expect(firstStorage.setItem).not.toHaveBeenCalled();
  });
});

const SUPPRESSION_KEY = "proliferate.cloudDisplayNameBackfillSuppression.v1";

function renderSuppressionAuthority() {
  return renderHook(() => {
    useCloudDisplayNameBackfillSuppressionLifecycle();
    return useCloudDisplayNameBackfillSuppressionAuthority();
  });
}

function createStorageHarness(initial: Record<string, true> | null = null) {
  const values = new Map<string, string>();
  if (initial) values.set(SUPPRESSION_KEY, JSON.stringify(initial));
  const getItem = vi.fn(async (key: string) => values.get(key) ?? null);
  const setItem = vi.fn(async (key: string, value: string) => {
    values.set(key, value);
  });
  const removeItem = vi.fn(async (key: string) => {
    values.delete(key);
  });
  const captureException = vi.fn();
  return {
    values,
    getItem,
    setItem,
    removeItem,
    captureException,
    context: {
      storage: { getItem, setItem, removeItem },
      captureException,
    },
  };
}
