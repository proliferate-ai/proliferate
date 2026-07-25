// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";

import { useSessionReplacementTombstoneAuthority } from "@/hooks/sessions/derived/use-session-replacement-tombstone-authority";
import { useSessionReplacementTombstonesLifecycle } from "@/hooks/sessions/lifecycle/use-session-replacement-tombstones-lifecycle";
import {
  waitForSessionReplacementTombstoneHydration,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-authority";
import {
  commitReplacedSessionTombstone,
  committedReplacedSessionTombstonesForWorkspace,
  resetReplacedSessionTombstonesForTests,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-durable-operations";
import {
  isReplacedSessionTombstoned,
  stageReplacedSessionTombstone,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  isCloudDisplayNameBackfillSuppressed,
  resetCloudDisplayNameBackfillSuppressionForTests,
  useCloudDisplayNameBackfillSuppressionAuthority,
  useCloudDisplayNameBackfillSuppressionLifecycle,
} from "@/hooks/workspaces/lifecycle/cloud-display-name-backfill-suppression";

const persistenceMocks = vi.hoisted(() => {
  const getItem = vi.fn<(key: string) => Promise<string | null>>();
  const setItem = vi.fn<(
    key: string,
    value: string,
  ) => Promise<void>>(async () => undefined);
  const removeItem = vi.fn<(key: string) => Promise<void>>(async () => undefined);
  const captureException = vi.fn();
  const context = {
    storage: { getItem, setItem, removeItem },
    captureException,
  };
  return {
    getItem,
    setItem,
    removeItem,
    captureException,
    context,
    currentContext: context as ProductStorageContext,
  };
});

vi.mock("@/hooks/app/facade/use-product-storage-context", () => ({
  useProductStorageContext: () => persistenceMocks.currentContext,
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  persistenceMocks.getItem.mockResolvedValue(null);
  persistenceMocks.currentContext = persistenceMocks.context;
  resetCloudDisplayNameBackfillSuppressionForTests();
  resetReplacedSessionTombstonesForTests();
});

afterEach(cleanup);

describe("critical product persistence authority", () => {
  it("keeps Cloud display-name backfill gated until suppression hydrates", async () => {
    let resolveRead: (value: string | null) => void = () => undefined;
    persistenceMocks.getItem.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));

    const authority = renderHook(() => {
      useCloudDisplayNameBackfillSuppressionLifecycle();
      return useCloudDisplayNameBackfillSuppressionAuthority();
    });

    await waitFor(() => expect(authority.result.current.hydrated).toBe(false));
    await act(async () => {
      resolveRead(JSON.stringify({ "cloud-1": true }));
    });

    await waitFor(() => expect(authority.result.current.hydrated).toBe(true));
    expect(isCloudDisplayNameBackfillSuppressed("cloud-1")).toBe(true);
  });

  it("releases session consumers only after persisted tombstones hydrate", async () => {
    let resolveRead: (value: string | null) => void = () => undefined;
    persistenceMocks.getItem.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));

    const authority = renderHook(() => {
      useSessionReplacementTombstonesLifecycle();
      return useSessionReplacementTombstoneAuthority();
    });

    await waitFor(() => expect(authority.result.current.hydrated).toBe(false));
    let waiterResolved = false;
    const waiter = waitForSessionReplacementTombstoneHydration().then(() => {
      waiterResolved = true;
    });
    await act(async () => undefined);
    expect(waiterResolved).toBe(false);

    await act(async () => {
      resolveRead(JSON.stringify({
        "workspace-1": [{
          runtimeSessionId: "session-retired",
          suppressedSessionIds: ["session-retired"],
        }],
      }));
      await waiter;
    });

    await waitFor(() => expect(authority.result.current.hydrated).toBe(true));
    expect(isReplacedSessionTombstoned("workspace-1", "session-retired")).toBe(true);
  });

  it("makes Cloud authority fail closed on the first storage-replacement render", async () => {
    const observed: boolean[] = [];
    const authority = renderHook(() => {
      useCloudDisplayNameBackfillSuppressionLifecycle();
      const current = useCloudDisplayNameBackfillSuppressionAuthority();
      observed.push(current.hydrated);
      return current;
    });
    await waitFor(() => expect(authority.result.current.hydrated).toBe(true));

    let resolveReplacementRead: (value: string | null) => void = () => undefined;
    persistenceMocks.currentContext = createContext(() => new Promise((resolve) => {
      resolveReplacementRead = resolve;
    }));
    observed.length = 0;
    authority.rerender();

    expect(observed[0]).toBe(false);
    expect(authority.result.current.hydrated).toBe(false);
    await act(async () => resolveReplacementRead(null));
    await waitFor(() => expect(authority.result.current.hydrated).toBe(true));
  });

  it("makes Cloud authority fail closed before a same-storage remount reads it", async () => {
    const first = renderHook(() => {
      useCloudDisplayNameBackfillSuppressionLifecycle();
      return useCloudDisplayNameBackfillSuppressionAuthority();
    });
    await waitFor(() => expect(first.result.current.hydrated).toBe(true));
    first.unmount();

    let resolveRemountRead: (value: string | null) => void = () => undefined;
    persistenceMocks.getItem.mockReturnValueOnce(new Promise((resolve) => {
      resolveRemountRead = resolve;
    }));
    const observed: boolean[] = [];
    const remounted = renderHook(() => {
      useCloudDisplayNameBackfillSuppressionLifecycle();
      const current = useCloudDisplayNameBackfillSuppressionAuthority();
      observed.push(current.hydrated);
      return current;
    });

    expect(observed[0]).toBe(false);
    await act(async () => resolveRemountRead(null));
    await waitFor(() => expect(remounted.result.current.hydrated).toBe(true));
  });

  it("makes tombstone authority fail closed on the first storage-replacement render", async () => {
    const observed: boolean[] = [];
    const authority = renderHook(() => {
      useSessionReplacementTombstonesLifecycle();
      const current = useSessionReplacementTombstoneAuthority();
      observed.push(current.hydrated);
      return current;
    });
    await waitFor(() => expect(authority.result.current.hydrated).toBe(true));

    let resolveReplacementRead: (value: string | null) => void = () => undefined;
    persistenceMocks.currentContext = createContext(() => new Promise((resolve) => {
      resolveReplacementRead = resolve;
    }));
    observed.length = 0;
    authority.rerender();

    expect(observed[0]).toBe(false);
    expect(authority.result.current.hydrated).toBe(false);
    await act(async () => resolveReplacementRead(null));
    await waitFor(() => expect(authority.result.current.hydrated).toBe(true));
  });

  it("makes tombstone authority fail closed before a same-storage remount reads it", async () => {
    const first = renderHook(() => {
      useSessionReplacementTombstonesLifecycle();
      return useSessionReplacementTombstoneAuthority();
    });
    await waitFor(() => expect(first.result.current.hydrated).toBe(true));
    first.unmount();

    let resolveRemountRead: (value: string | null) => void = () => undefined;
    persistenceMocks.getItem.mockReturnValueOnce(new Promise((resolve) => {
      resolveRemountRead = resolve;
    }));
    const observed: boolean[] = [];
    const remounted = renderHook(() => {
      useSessionReplacementTombstonesLifecycle();
      const current = useSessionReplacementTombstoneAuthority();
      observed.push(current.hydrated);
      return current;
    });

    expect(observed[0]).toBe(false);
    await act(async () => resolveRemountRead(null));
    await waitFor(() => expect(remounted.result.current.hydrated).toBe(true));
  });

  it("isolates a replacement storage and persists only its own tombstones", async () => {
    persistenceMocks.getItem.mockResolvedValueOnce(JSON.stringify({
      "workspace-1": [{
        runtimeSessionId: "storage-a",
        suppressedSessionIds: ["storage-a"],
      }],
    }));
    const authority = renderHook(() => {
      useSessionReplacementTombstonesLifecycle();
      return useSessionReplacementTombstoneAuthority();
    });
    await waitFor(() => expect(authority.result.current.hydrated).toBe(true));

    let resolveStorageB: (value: string | null) => void = () => undefined;
    const storageB = createContext(() => new Promise((resolve) => {
      resolveStorageB = resolve;
    }));
    persistenceMocks.currentContext = storageB;
    authority.rerender();
    expect(authority.result.current.hydrated).toBe(false);
    stageReplacedSessionTombstone("workspace-1", "storage-b-live");
    await expect(commitReplacedSessionTombstone(
      persistenceMocks.currentContext,
      "workspace-1",
      "storage-b-live",
    ))
      .resolves.toBe(false);

    await act(async () => resolveStorageB(JSON.stringify({
      "workspace-1": [{
        runtimeSessionId: "storage-b",
        suppressedSessionIds: ["storage-b"],
      }],
    })));
    await waitFor(() => expect(authority.result.current.hydrated).toBe(true));
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual(["storage-b"]);
    expect(isReplacedSessionTombstoned("workspace-1", "storage-a")).toBe(false);

    await expect(commitReplacedSessionTombstone(
      persistenceMocks.currentContext,
      "workspace-1",
      "storage-b-live",
    ))
      .resolves.toBe(true);
    const lastStorageBWrite = storageB.storage.setItem.mock.calls[
      storageB.storage.setItem.mock.calls.length - 1
    ];
    expect(JSON.parse(lastStorageBWrite?.[1] ?? "{}"))
      .toEqual({
        "workspace-1": [
          {
            runtimeSessionId: "storage-b",
            suppressedSessionIds: ["storage-b"],
          },
          {
            runtimeSessionId: "storage-b-live",
            suppressedSessionIds: ["storage-b-live"],
          },
        ],
      });
  });
});

function createContext(getItem: (key: string) => Promise<string | null>) {
  return {
    storage: {
      getItem,
      setItem: vi.fn<(
        key: string,
        value: string,
      ) => Promise<void>>(async () => undefined),
      removeItem: vi.fn<(key: string) => Promise<void>>(async () => undefined),
    },
    captureException: vi.fn(),
  };
}
