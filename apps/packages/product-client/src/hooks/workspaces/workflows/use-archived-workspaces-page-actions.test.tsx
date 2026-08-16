// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";
import { useArchivedWorkspacesPageActions } from "#product/hooks/workspaces/workflows/use-archived-workspaces-page-actions";

const mocks = vi.hoisted(() => ({
  unarchive: vi.fn(),
}));

vi.mock("#product/hooks/workspaces/cache/use-archived-workspaces", () => ({
  useArchivedWorkspaces: () => ({
    data: [{ id: "w1", displayName: "my-workspace", path: "/tmp/root-1/w1" }],
    isLoading: false,
  }),
}));

vi.mock("#product/hooks/workspaces/cache/use-archived-workspaces-invalidation", () => ({
  useArchivedWorkspacesInvalidation: () => vi.fn(async () => undefined),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({ data: { repoRoots: [] } }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspace-collections-invalidation", () => ({
  useWorkspaceCollectionsInvalidation: () => vi.fn(async () => undefined),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-purge-actions", () => ({
  useWorkspacePurgeActions: () => ({ markDone: vi.fn(async () => undefined) }),
}));

vi.mock("#product/providers/WorkspaceArchiveActionsProvider", () => ({
  useWorkspaceArchiveActionsContext: () => ({
    unarchive: (...args: unknown[]) => mocks.unarchive(...args),
    scenario: null,
    dismissScenario: vi.fn(),
  }),
}));

vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (
    selector: (state: { runtimeUrl: string }) => unknown,
  ) => selector({ runtimeUrl: "http://localhost:7007" }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { showError: () => void }) => unknown) =>
    selector({ showError: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useArchivedWorkspacesPageActions — unarchive optimistic settle", () => {
  it("keeps the row hidden until motion.delay.optimisticSettleTimeoutMs elapses with no decision, then reinstates it", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useArchivedWorkspacesPageActions());

    act(() => {
      result.current.requestUnarchive("w1");
    });
    // The exit-collapse delay (duration.disclosureMs) must run out before the
    // unarchive call itself fires.
    act(() => {
      vi.advanceTimersByTime(motion.duration.disclosureMs);
    });
    expect(mocks.unarchive).toHaveBeenCalledWith("w1", expect.any(String));
    expect(result.current.exitingIds.has("w1")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(motion.delay.optimisticSettleTimeoutMs - 1);
    });
    expect(result.current.exitingIds.has("w1")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.exitingIds.has("w1")).toBe(false);
  });
});
