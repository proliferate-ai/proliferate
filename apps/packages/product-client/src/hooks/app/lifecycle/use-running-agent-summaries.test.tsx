// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";

// Drive busy-ness off a plain `busy` flag on each entry, same seam as
// use-export-running-agent-count.test.tsx, so this test does not depend on the
// full directory-entry / activity shapes.
vi.mock("#product/domain/sessions/activity", () => ({
  isSessionSlotBusy: (snapshot: { busy?: boolean } | null) => snapshot?.busy === true,
}));
vi.mock("#product/lib/domain/sessions/directory/directory-activity", () => ({
  activitySnapshotFromDirectoryEntry: (entry: unknown) => entry,
  // Also mocked because the session-directory store imports it at module load.
  activityFromTranscript: () => ({}),
}));

import { useRunningAgentSummaries } from "#product/hooks/app/lifecycle/use-running-agent-summaries";

type Entries = Record<string, { busy: boolean; title: string | null; workspaceId: string | null }>;

function setEntries(entries: Entries) {
  useSessionDirectoryStore.setState({ entriesById: entries as never });
}

beforeEach(() => {
  setEntries({});
});

describe("useRunningAgentSummaries", () => {
  it("returns only busy entries, projected to title/workspaceId", () => {
    setEntries({
      a: { busy: true, title: "Fix flaky test", workspaceId: "w1" },
      b: { busy: false, title: "Idle one", workspaceId: "w2" },
    });

    const { result } = renderHook(() => useRunningAgentSummaries());

    expect(result.current).toEqual([{ title: "Fix flaky test", workspaceId: "w1" }]);
  });

  it("includes entries with a null title (untitled sessions)", () => {
    setEntries({
      a: { busy: true, title: null, workspaceId: "w1" },
    });

    const { result } = renderHook(() => useRunningAgentSummaries());

    expect(result.current).toEqual([{ title: null, workspaceId: "w1" }]);
  });

  it("updates reactively as entries change", () => {
    const { result } = renderHook(() => useRunningAgentSummaries());
    expect(result.current).toEqual([]);

    act(() =>
      setEntries({ a: { busy: true, title: "First", workspaceId: "w1" } }),
    );
    expect(result.current).toEqual([{ title: "First", workspaceId: "w1" }]);

    act(() => setEntries({}));
    expect(result.current).toEqual([]);
  });

  it("keeps the same array reference when membership/titles are unchanged", () => {
    setEntries({ a: { busy: true, title: "First", workspaceId: "w1" } });
    const { result, rerender } = renderHook(() => useRunningAgentSummaries());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
