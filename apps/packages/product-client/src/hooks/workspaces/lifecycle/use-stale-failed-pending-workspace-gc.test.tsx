// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import {
  useStaleFailedPendingWorkspaceGc,
} from "#product/hooks/workspaces/lifecycle/use-stale-failed-pending-workspace-gc";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const DAY_MS = 24 * 60 * 60 * 1000;

function entry(args: {
  attemptId: string;
  stage: PendingWorkspaceEntry["stage"];
  ageMs: number;
}): PendingWorkspaceEntry {
  return {
    ...buildSubmittingPendingWorkspaceEntry({
      attemptId: args.attemptId,
      selectedWorkspaceId: null,
      source: "local-created",
      displayName: args.attemptId,
      request: { kind: "local", sourceRoot: "/tmp/landing" },
    }),
    stage: args.stage,
    createdAt: Date.now() - args.ageMs,
  };
}

describe("useStaleFailedPendingWorkspaceGc", () => {
  beforeEach(() => {
    useSessionSelectionStore.getState().clearSelection();
  });

  afterEach(cleanup);

  it("drops day-old failures and keeps everything else", () => {
    useSessionSelectionStore.setState({
      pendingWorkspaces: [
        entry({ attemptId: "stale-failure", stage: "failed", ageMs: DAY_MS + 1_000 }),
        entry({ attemptId: "recent-failure", stage: "failed", ageMs: 60_000 }),
        // A launch this old is stuck, not stale — ending it would abort work
        // that may still be running, so only failures are swept.
        entry({ attemptId: "old-launch", stage: "submitting", ageMs: DAY_MS + 1_000 }),
      ].reduce(upsertPendingWorkspaceEntry, EMPTY_PENDING_WORKSPACE_REGISTRY),
    });

    renderHook(() => useStaleFailedPendingWorkspaceGc());

    expect(useSessionSelectionStore.getState().pendingWorkspaces.attemptOrder)
      .toEqual(["recent-failure", "old-launch"]);
  });

  // PR #1870 review finding 3: the registry is in-memory and the host that
  // mounts this hook lives for the whole authenticated session, so a sweep that
  // only ran at mount would only ever see an empty registry. The failure has to
  // become collectable while the app is already running.
  it("collects a failure that goes stale during the session", () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useStaleFailedPendingWorkspaceGc());

      // Registered after mount, exactly as a launch that fails mid-session is.
      useSessionSelectionStore.setState({
        pendingWorkspaces: upsertPendingWorkspaceEntry(
          EMPTY_PENDING_WORKSPACE_REGISTRY,
          entry({ attemptId: "mid-session-failure", stage: "failed", ageMs: 0 }),
        ),
      });

      act(() => {
        vi.advanceTimersByTime(DAY_MS + 60 * 60 * 1000);
      });

      expect(useSessionSelectionStore.getState().pendingWorkspaces.attemptOrder)
        .toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
