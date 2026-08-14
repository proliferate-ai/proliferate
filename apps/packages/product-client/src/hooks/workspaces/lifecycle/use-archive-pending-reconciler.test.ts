// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@anyharness/sdk";
import { useArchivePendingReconciler } from "#product/hooks/workspaces/lifecycle/use-archive-pending-reconciler";

const mocks = vi.hoisted(() => ({
  list: vi.fn<() => Promise<Workspace[]>>(),
}));

vi.mock("#product/lib/access/anyharness/workspaces", () => ({
  listRuntimeWorkspaces: (...args: unknown[]) => mocks.list(...(args as [])),
}));

vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (
    selector: (state: { runtimeUrl: string }) => unknown,
  ) => selector({ runtimeUrl: "http://localhost:7007" }),
}));

function makeWorkspace(id: string, lifecycleState: string): Workspace {
  return { id, lifecycleState } as unknown as Workspace;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.list.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useArchivePendingReconciler", () => {
  it("does not poll while the pending set is empty", () => {
    renderHook(() =>
      useArchivePendingReconciler({
        pendingIds: new Set(),
        onConfirmedArchived: vi.fn(),
        onReinstated: vi.fn(),
      })
    );
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("prunes a pending id the poll confirms archived, firing confirmation", async () => {
    mocks.list.mockResolvedValue([makeWorkspace("w1", "archived")]);
    const onConfirmedArchived = vi.fn();
    const onReinstated = vi.fn();

    renderHook(() =>
      useArchivePendingReconciler({
        pendingIds: new Set(["w1"]),
        onConfirmedArchived,
        onReinstated,
        pollIntervalMs: 1000,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(onConfirmedArchived).toHaveBeenCalledWith("w1");
    expect(onReinstated).not.toHaveBeenCalled();
  });

  it("reinstates a pending id the server still reports active, with no failure toast (no-op call)", async () => {
    mocks.list.mockResolvedValue([makeWorkspace("w1", "active")]);
    const onConfirmedArchived = vi.fn();
    const onReinstated = vi.fn();

    renderHook(() =>
      useArchivePendingReconciler({
        pendingIds: new Set(["w1"]),
        onConfirmedArchived,
        onReinstated,
        pollIntervalMs: 1000,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(onReinstated).toHaveBeenCalledWith("w1");
    expect(onConfirmedArchived).not.toHaveBeenCalled();
  });

  it("leaves an id the server does not recognize pending (no callback either way)", async () => {
    mocks.list.mockResolvedValue([]);
    const onConfirmedArchived = vi.fn();
    const onReinstated = vi.fn();

    renderHook(() =>
      useArchivePendingReconciler({
        pendingIds: new Set(["w1"]),
        onConfirmedArchived,
        onReinstated,
        pollIntervalMs: 1000,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(onConfirmedArchived).not.toHaveBeenCalled();
    expect(onReinstated).not.toHaveBeenCalled();
  });

  it("stops polling once the pending set empties", async () => {
    mocks.list.mockResolvedValue([makeWorkspace("w1", "archived")]);
    const { rerender } = renderHook(
      ({ pendingIds }: { pendingIds: ReadonlySet<string> }) =>
        useArchivePendingReconciler({
          pendingIds,
          onConfirmedArchived: vi.fn(),
          onReinstated: vi.fn(),
          pollIntervalMs: 1000,
        }),
      { initialProps: { pendingIds: new Set(["w1"]) } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const callsAfterFirstPoll = mocks.list.mock.calls.length;
    expect(callsAfterFirstPoll).toBeGreaterThan(0);

    rerender({ pendingIds: new Set() });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.list.mock.calls.length).toBe(callsAfterFirstPoll);
  });
});
