// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

// Drive the busy count off a plain `busy` flag on each entry so the test does
// not depend on the full directory-entry / activity shapes.
vi.mock("@proliferate/product-domain/sessions/activity", () => ({
  isSessionSlotBusy: (snapshot: { busy?: boolean } | null) =>
    snapshot?.busy === true,
}));
vi.mock("@/lib/domain/sessions/directory/directory-activity", () => ({
  activitySnapshotFromDirectoryEntry: (entry: unknown) => entry,
  // Also mocked because the session-directory store imports it at module load.
  activityFromTranscript: () => ({}),
}));

import { useExportRunningAgentCount } from "./use-export-running-agent-count";

type Entries = Record<string, { busy: boolean }>;

function setEntries(entries: Entries) {
  useSessionDirectoryStore.setState({ entriesById: entries as never });
}

beforeEach(() => {
  setEntries({});
});

describe("useExportRunningAgentCount", () => {
  it("exports the initial busy count once on mount", () => {
    setEntries({ a: { busy: true } });
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useExportRunningAgentCount(setRunningAgentCount));

    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);
    expect(setRunningAgentCount).toHaveBeenCalledWith(1);
  });

  it("exports only when the busy count changes", () => {
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useExportRunningAgentCount(setRunningAgentCount));
    expect(setRunningAgentCount).toHaveBeenLastCalledWith(0);

    act(() => setEntries({ a: { busy: true } }));
    expect(setRunningAgentCount).toHaveBeenLastCalledWith(1);

    act(() => setEntries({ a: { busy: true }, b: { busy: true } }));
    expect(setRunningAgentCount).toHaveBeenLastCalledWith(2);

    act(() => setEntries({ a: { busy: false }, b: { busy: false } }));
    expect(setRunningAgentCount).toHaveBeenLastCalledWith(0);

    // initial(0) + 1 + 2 + 0
    expect(setRunningAgentCount).toHaveBeenCalledTimes(4);
  });

  it("does not re-export when the count is unchanged", () => {
    setEntries({ a: { busy: true } });
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useExportRunningAgentCount(setRunningAgentCount));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);

    // Directory changes but the busy count stays 1.
    act(() => setEntries({ a: { busy: true }, b: { busy: false } }));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);
  });

  it("does not re-subscribe when the same callback is passed again", () => {
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ cb }) => useExportRunningAgentCount(cb),
      { initialProps: { cb: setRunningAgentCount } },
    );
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);

    rerender({ cb: setRunningAgentCount });
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);
  });

  it("re-exports the initial count when the callback identity changes", () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ cb }) => useExportRunningAgentCount(cb),
      { initialProps: { cb: first } },
    );
    expect(first).toHaveBeenCalledTimes(1);

    const second = vi.fn().mockResolvedValue(undefined);
    rerender({ cb: second });
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(0);
  });

  it("unsubscribes on unmount", () => {
    const setRunningAgentCount = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useExportRunningAgentCount(setRunningAgentCount),
    );
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);

    unmount();
    act(() => setEntries({ a: { busy: true } }));
    expect(setRunningAgentCount).toHaveBeenCalledTimes(1);
  });
});
