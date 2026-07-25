// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComputeTargetAppearancePreference } from "@/lib/domain/compute/target-appearance";
import { useComputeTargetAppearancePreferences } from "./use-compute-target-appearance-preferences";

const persistenceMocks = vi.hoisted(() => ({
  context: null as null | {
    storage: {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<void>;
      removeItem: (key: string) => Promise<void>;
    };
    captureException: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("@/hooks/app/facade/use-product-storage-context", () => ({
  useProductStorageContext: () => persistenceMocks.context,
}));

afterEach(cleanup);

const TARGET_ONE: ComputeTargetAppearancePreference = {
  targetId: "target-one",
  displayName: "Target One",
  iconId: "cloud",
  colorId: "green",
};

const TARGET_TWO: ComputeTargetAppearancePreference = {
  targetId: "target-two",
  displayName: "Target Two",
  iconId: "monitor",
  colorId: "red",
};

describe("useComputeTargetAppearancePreferences", () => {
  it("ignores a stale read after ProductStorage is replaced", async () => {
    let resolveOldRead: (value: string | null) => void = () => undefined;
    persistenceMocks.context = createContext(() => new Promise((resolve) => {
      resolveOldRead = resolve;
    }));
    const rendered = renderHook(() => useComputeTargetAppearancePreferences());

    persistenceMocks.context = createContext(async () => JSON.stringify({
      current: {
        targetId: "current",
        displayName: "Current",
        iconId: "cloud",
        colorId: "green",
      },
    }));
    rendered.rerender();
    await waitFor(() => {
      expect(rendered.result.current.preferences.current?.displayName).toBe("Current");
    });

    await act(async () => resolveOldRead(JSON.stringify({
      stale: {
        targetId: "stale",
        displayName: "Stale",
        iconId: "monitor",
        colorId: "red",
      },
    })));

    expect(rendered.result.current.preferences.current?.displayName).toBe("Current");
    expect(rendered.result.current.preferences.stale).toBeUndefined();
  });

  it("ignores a deferred save completion from a replaced ProductStorage", async () => {
    const oldWrite = deferred<void>();
    const oldContext = createContext(async () => null);
    oldContext.storage.setItem = vi.fn(async () => oldWrite.promise);
    persistenceMocks.context = oldContext;
    const rendered = renderHook(() => useComputeTargetAppearancePreferences());
    await waitFor(() => expect(rendered.result.current.loading).toBe(false));

    let oldSave!: Promise<void>;
    act(() => {
      oldSave = rendered.result.current.savePreference(TARGET_ONE);
    });
    await waitFor(() => expect(oldContext.storage.setItem).toHaveBeenCalledOnce());

    persistenceMocks.context = createContext(async () => JSON.stringify({
      [TARGET_TWO.targetId]: TARGET_TWO,
    }));
    rendered.rerender();
    await waitFor(() => {
      expect(rendered.result.current.preferences).toEqual({
        [TARGET_TWO.targetId]: TARGET_TWO,
      });
    });

    await act(async () => {
      oldWrite.resolve();
      await oldSave;
    });

    expect(rendered.result.current.preferences).toEqual({
      [TARGET_TWO.targetId]: TARGET_TWO,
    });
  });
});

function createContext(getItem: (key: string) => Promise<string | null>) {
  return {
    storage: {
      getItem,
      setItem: vi.fn(async () => undefined),
      removeItem: vi.fn(async () => undefined),
    },
    captureException: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
