// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replaySessionHistory } from "#product/lib/domain/sessions/stream/stream-state";
import { SessionTranscriptPane } from "#product/components/workspace/chat/surface/SessionTranscriptPane";
import {
  beginRendererFlow,
  deferWorkspaceOpenContentStable,
  markRendererFlowDataReady,
  markRendererFlowShellCommitted,
  resetRendererFlowsForTest,
} from "#product/lib/infra/diagnostics/renderer-flow-timing";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
  type RendererDiagnosticInput,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import {
  createEmptySessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

const hydrationMocks = vi.hoisted(() => ({
  rehydrateSessionSlotFromHistory: vi.fn(),
}));

// Heavy leaf UI is not under test — the deferred content_stable hand-off is.
// The mock echoes the two inset props it received as data attributes so
// dock-reactivity (the background-work row staying live-reactive to
// bottomInsetPx/nonDisplacingBottomInsetPx) can be asserted without needing
// the real virtualized transcript. It also exposes two plain buttons that
// invoke `onIsPinnedToBottomChange`, standing in for the REAL stick-to-bottom
// engine's reported pin state — this suite doesn't mount the real virtualized
// row list, so it can't fire a genuine scroll event.
vi.mock("#product/components/workspace/chat/transcript/MessageList", () => ({
  MessageList: (props: {
    bottomInsetPx: number;
    nonDisplacingBottomInsetPx: number;
    onIsPinnedToBottomChange?: (isPinnedToBottom: boolean) => void;
  }) => (
    <>
      <div
        data-testid="message-list"
        data-bottom-inset-px={props.bottomInsetPx}
        data-non-displacing-bottom-inset-px={props.nonDisplacingBottomInsetPx}
      />
      <button
        type="button"
        data-testid="simulate-scroll-away"
        onClick={() => props.onIsPinnedToBottomChange?.(false)}
      />
      <button
        type="button"
        data-testid="simulate-scroll-to-bottom"
        onClick={() => props.onIsPinnedToBottomChange?.(true)}
      />
    </>
  ),
}));
vi.mock("#product/components/workspace/chat/plans/ConnectedPlanHandoffDialog", () => ({
  ConnectedPlanHandoffDialog: () => null,
}));
vi.mock("#product/components/workspace/chat/surface/TranscriptSwitchingPlaceholder", () => ({
  TranscriptSwitchingPlaceholder: () => <div data-testid="placeholder" />,
}));
vi.mock("#product/components/diagnostics/DebugProfiler", () => ({
  DebugProfiler: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("#product/hooks/ui/debug/use-debug-render-count", () => ({
  useDebugRenderCount: () => {},
}));
// The pane self-hydration path is exercised elsewhere; here we drive hydration
// completion explicitly via the flag, so a no-op rehydrate keeps host wiring out.
vi.mock("#product/hooks/sessions/lifecycle/use-session-history-hydration", () => ({
  useSessionHistoryHydration: () => ({
    rehydrateSessionSlotFromHistory: hydrationMocks.rehydrateSessionSlotFromHistory,
  }),
}));
vi.mock("#product/hooks/plans/ui/use-plan-handoff-dialog-state", () => ({
  usePlanHandoffDialogState: () => ({ plan: null, open: vi.fn(), close: vi.fn() }),
}));
vi.mock("#product/hooks/chat/workflows/use-transcript-session-navigation-actions", () => ({
  useTranscriptSessionNavigationActions: () => ({
    canOpenTranscriptSession: false,
    openTranscriptSession: vi.fn(),
  }),
}));
vi.mock("#product/hooks/workspaces/derived/use-workspace-creation-receipt", () => ({
  useWorkspaceCreationReceiptKey: () => null,
}));
const backgroundWorkMocks = vi.hoisted(() => ({
  openBackgroundWorkPane: vi.fn(),
  rowCounts: { runningCount: 0, finishedCount: 0 },
}));
// Requires ProductHostProvider (`useWorkspaceFileContext` -> `useWorkspaces`)
// via real host wiring that is out of scope for this diagnostics-timing
// suite; the mechanism itself is covered by
// use-open-background-work-pane.test.tsx. Here we only need to assert the
// transcript row's `onOpen` is wired to whatever this hook returns.
vi.mock("#product/hooks/activity/workflows/use-open-background-work-pane", () => ({
  useOpenBackgroundWorkPane: () => backgroundWorkMocks.openBackgroundWorkPane,
}));
vi.mock("#product/hooks/activity/derived/use-background-work-row", () => ({
  useBackgroundWorkRowCounts: () => backgroundWorkMocks.rowCounts,
}));

const WORKSPACE_ID = "workspace-1";
const SESSION_ID = "session-1";

let emitted: RendererDiagnosticInput[];
let nowValue: number;

beforeEach(() => {
  emitted = [];
  setRendererDiagnosticsSink({ emit: (input) => emitted.push(input) });
  nowValue = 0;
  hydrationMocks.rehydrateSessionSlotFromHistory.mockReset().mockResolvedValue(false);
  vi.spyOn(performance, "now").mockImplementation(() => nowValue);
  resetRendererFlowsForTest();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionIntentStore.getState().clear();
  useSessionTranscriptStore.getState().clearEntries();
  useSessionSelectionStore.getState().deselectWorkspacePreservingSessions();
  backgroundWorkMocks.rowCounts = { runningCount: 0, finishedCount: 0 };
  backgroundWorkMocks.openBackgroundWorkPane.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetRendererFlowsForTest();
  resetRendererDiagnosticsSinkForTest();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionIntentStore.getState().clear();
  useSessionTranscriptStore.getState().clearEntries();
  useSessionSelectionStore.getState().deselectWorkspacePreservingSessions();
});

/**
 * Simulates the real cold workspace-open: the bootstrap begins the
 * workspace_open flow and, because transcript hydration is off its critical
 * path, DEFERS content_stable to this session; selectSession synchronously
 * seeds the empty-but-truthy scaffold via createEmptySessionRecord.
 */
function beginDeferredColdOpen(options?: { includeTranscriptEntry?: boolean }): void {
  beginRendererFlow({
    kind: "workspace_open",
    correlationKey: WORKSPACE_ID,
    correlation: { workspaceId: WORKSPACE_ID },
  });
  nowValue = 10;
  markRendererFlowShellCommitted({ kind: "workspace_open", correlationKey: WORKSPACE_ID });
  nowValue = 35;
  markRendererFlowDataReady({ kind: "workspace_open", correlationKey: WORKSPACE_ID });
  deferWorkspaceOpenContentStable({ sessionId: SESSION_ID, correlationKey: WORKSPACE_ID });
  // Real scaffold: createEmptySessionRecord carries an empty-but-truthy
  // TranscriptState and transcriptHydrated=false.
  const record = createEmptySessionRecord(SESSION_ID, "codex", { workspaceId: WORKSPACE_ID });
  if (options?.includeTranscriptEntry === false) {
    useSessionDirectoryStore.getState().putEntry(record);
  } else {
    putSessionRecord(record);
  }
  useSessionSelectionStore.getState().activateWorkspace({
    logicalWorkspaceId: WORKSPACE_ID,
    workspaceId: WORKSPACE_ID,
    initialActiveSessionId: SESSION_ID,
  });
}

function contentStable(): RendererDiagnosticInput | undefined {
  return emitted.find((entry) => entry.name === "renderer.flow.content_stable");
}

function renderPane() {
  return render(<SessionTranscriptPane bottomInsetPx={0} nonDisplacingBottomInsetPx={0} />);
}

describe("SessionTranscriptPane deferred workspace_open content_stable", () => {
  it("keeps a failed self-hydration uncommitted and retryable", async () => {
    beginDeferredColdOpen({ includeTranscriptEntry: false });
    renderPane();

    await waitFor(() => {
      expect(hydrationMocks.rehydrateSessionSlotFromHistory).toHaveBeenCalledOnce();
    });

    expect(
      useSessionDirectoryStore.getState().entriesById[SESSION_ID]?.transcriptHydrated,
    ).toBe(false);
    expect(contentStable()).toBeUndefined();
  });

  it("commits successful self-hydration", async () => {
    hydrationMocks.rehydrateSessionSlotFromHistory.mockResolvedValueOnce(true);
    beginDeferredColdOpen({ includeTranscriptEntry: false });
    renderPane();

    await waitFor(() => {
      expect(
        useSessionDirectoryStore.getState().entriesById[SESSION_ID]?.transcriptHydrated,
      ).toBe(true);
    });

    expect(contentStable()).toBeDefined();
  });

  it("does NOT finish on the empty scaffold, then finishes once hydration lands", () => {
    beginDeferredColdOpen();
    renderPane();

    // Scaffold present (empty-but-truthy transcript) but transcriptHydrated is
    // still false: the bootstrap kickoff owns hydration, and content_stable
    // must not fire against the scaffold.
    expect(hydrationMocks.rehydrateSessionSlotFromHistory).not.toHaveBeenCalled();
    expect(contentStable()).toBeUndefined();

    // Hydration completes 1.5s later — exactly the case that used to be measured.
    nowValue = 1_535;
    act(() => {
      const initial = replaySessionHistory(SESSION_ID, []);
      patchSessionRecord(SESSION_ID, {
        events: initial.events,
        transcript: initial.transcript,
        transcriptHydrated: true,
      });
    });

    const stable = contentStable();
    expect(stable).toBeDefined();
    // Honest measurement: data_to_stable reflects the real hydration wait
    // (1535 - 35 = 1500), not ~0 against the scaffold.
    expect(stable?.fields?.data_to_stable_ms?.value).toBe(1_500);
  });

  it("counts a hydrated-empty session (zero messages) as stable", () => {
    beginDeferredColdOpen();
    renderPane();
    expect(contentStable()).toBeUndefined();

    // New workspace, zero messages: transcript stays the empty scaffold, only
    // the hydrated flag flips. This must still finish the flow.
    nowValue = 200;
    act(() => {
      patchSessionRecord(SESSION_ID, { transcriptHydrated: true });
    });

    expect(contentStable()).toBeDefined();
  });
});

describe("SessionTranscriptPane background-work row (carried R1 items)", () => {
  it("passes the live, unclamped bottomInsetPx/nonDisplacingBottomInsetPx through to MessageList even while the row is visible (carried item 1: dock-reactivity)", () => {
    backgroundWorkMocks.rowCounts = { runningCount: 2, finishedCount: 0 };
    beginDeferredColdOpen();
    render(<SessionTranscriptPane bottomInsetPx={64} nonDisplacingBottomInsetPx={8} />);

    const messageList = screen.getByTestId("message-list");
    expect(messageList.getAttribute("data-bottom-inset-px")).toBe("64");
    expect(messageList.getAttribute("data-non-displacing-bottom-inset-px")).toBe("8");
    expect(screen.getByText("2 background tasks")).toBeTruthy();
  });

  it("still passes the same inset values through when there is no background work", () => {
    backgroundWorkMocks.rowCounts = { runningCount: 0, finishedCount: 0 };
    beginDeferredColdOpen();
    render(<SessionTranscriptPane bottomInsetPx={64} nonDisplacingBottomInsetPx={8} />);

    const messageList = screen.getByTestId("message-list");
    expect(messageList.getAttribute("data-bottom-inset-px")).toBe("64");
    expect(messageList.getAttribute("data-non-displacing-bottom-inset-px")).toBe("8");
    expect(screen.queryByText(/background task/)).toBeNull();
  });

  it("wires the transcript row's onOpen to the background-work-pane open action (carried R1 seam, R2 wiring)", () => {
    backgroundWorkMocks.rowCounts = { runningCount: 1, finishedCount: 0 };
    beginDeferredColdOpen();
    render(<SessionTranscriptPane bottomInsetPx={0} nonDisplacingBottomInsetPx={0} />);

    fireEvent.click(screen.getByText("1 background task"));

    expect(backgroundWorkMocks.openBackgroundWorkPane).toHaveBeenCalledTimes(1);
  });

  // The row is real content sitting ABOVE MessageList's own reserved
  // end-padding, not a scrim inside it — its own height must be reserved
  // too, or it paints over the last turn's tail. jsdom's
  // `getBoundingClientRect` returns all-zero rects by default, so this test
  // spies it to a fixed, nonzero row height to exercise the real
  // measure -> augment -> anchor wiring (the actual pixel geometry is proven
  // end-to-end by the throwaway Playwright fixture, not by this unit test).
  it("reserves the row's own measured height on top of the live bottomInsetPx, and anchors the row at the raw bottomInsetPx regardless of nonDisplacing", () => {
    backgroundWorkMocks.rowCounts = { runningCount: 1, finishedCount: 0 };
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      height: 32,
      width: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    try {
      beginDeferredColdOpen();
      render(<SessionTranscriptPane bottomInsetPx={64} nonDisplacingBottomInsetPx={8} />);

      const messageList = screen.getByTestId("message-list");
      // Augmented total fed to MessageList = 64 + 32 (row height).
      expect(messageList.getAttribute("data-bottom-inset-px")).toBe("96");
      expect(messageList.getAttribute("data-non-displacing-bottom-inset-px")).toBe("8");

      const rowAnchor = screen.getByTestId("background-work-row-anchor");
      // Anchored at the raw bottomInsetPx (64), NOT `bottomInsetPx -
      // nonDisplacing` (56) — the last real row's distance from the
      // viewport's bottom is `bottomInsetPx`, constant regardless of the
      // nonDisplacing/structural split, because the composer's scrim overlay
      // (`VirtualTranscriptViewport`'s `top-full` sibling div) extends the
      // scrollable region by exactly `nonDisplacing` past the shrunk
      // `structural` paddingEnd. Anchoring at the structural share alone
      // (56) would reopen an 8px gap — confirmed via Playwright measurement
      // (see the throwaway fixture in the PR description).
      expect(rowAnchor.style.bottom).toBe("64px");
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("does not augment MessageList's bottomInsetPx when there is no background work, even if a stale row height was measured earlier", () => {
    backgroundWorkMocks.rowCounts = { runningCount: 0, finishedCount: 0 };
    beginDeferredColdOpen();
    render(<SessionTranscriptPane bottomInsetPx={64} nonDisplacingBottomInsetPx={8} />);

    const messageList = screen.getByTestId("message-list");
    expect(messageList.getAttribute("data-bottom-inset-px")).toBe("64");
    expect(screen.queryByTestId("background-work-row-anchor")).toBeNull();
  });

  // A floating row that stays visible while the user has scrolled away from
  // the bottom would paint over arbitrary mid-transcript content, so the row
  // must hide the instant the transcript is no longer pinned to bottom,
  // reusing the SAME `isPinnedToBottom` signal the stick-to-bottom engine
  // already computes (reported here via the mocked MessageList's
  // `onIsPinnedToBottomChange`, standing in for a real scroll). The reserve
  // stays constant across pin flips; only the row's render reacts to pin —
  // shrinking `paddingEnd` on unpin isn't covered by the stick-to-bottom
  // engine's non-user-scroll guard (keyed only on `autoFollowBottomInsetPx`,
  // not this row's height), so a live shrink could strand the viewport at
  // zero distance-from-bottom but unpinned. The reserved band is below the
  // fold and invisible while unpinned regardless, so there is no visible
  // cost to keeping it constant for as long as background work exists.
  it("hides the row (but keeps the reserved inset) the instant the transcript scrolls away from the bottom, then restores the row on return to bottom", () => {
    backgroundWorkMocks.rowCounts = { runningCount: 1, finishedCount: 0 };
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      height: 32,
      width: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    try {
      beginDeferredColdOpen();
      render(<SessionTranscriptPane bottomInsetPx={64} nonDisplacingBottomInsetPx={8} />);

      // Pinned by default: row present, inset augmented by its measured height.
      expect(screen.getByTestId("background-work-row-anchor")).toBeTruthy();
      expect(screen.getByTestId("message-list").getAttribute("data-bottom-inset-px")).toBe("96");

      // Scrolled away: only the row disappears — the reserve stays augmented
      // (it's below the fold, invisible while unpinned, and must not shrink
      // paddingEnd mid-scroll purely from unpinning).
      fireEvent.click(screen.getByTestId("simulate-scroll-away"));
      expect(screen.queryByTestId("background-work-row-anchor")).toBeNull();
      expect(screen.getByTestId("message-list").getAttribute("data-bottom-inset-px")).toBe("96");

      // Back to bottom: the row reappears; the inset was never disturbed.
      fireEvent.click(screen.getByTestId("simulate-scroll-to-bottom"));
      expect(screen.getByTestId("background-work-row-anchor")).toBeTruthy();
      expect(screen.getByTestId("message-list").getAttribute("data-bottom-inset-px")).toBe("96");
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("drops the reserved inset to the plain bottomInsetPx only when background work itself ends, even while unpinned", () => {
    backgroundWorkMocks.rowCounts = { runningCount: 1, finishedCount: 0 };
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      height: 32,
      width: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    try {
      beginDeferredColdOpen();
      const { rerender } = render(
        <SessionTranscriptPane bottomInsetPx={64} nonDisplacingBottomInsetPx={8} />,
      );

      fireEvent.click(screen.getByTestId("simulate-scroll-away"));
      expect(screen.getByTestId("message-list").getAttribute("data-bottom-inset-px")).toBe("96");

      // Background work itself ends (independent of pin state): the reserve
      // must drop back to the plain bottomInsetPx — no ghost band.
      backgroundWorkMocks.rowCounts = { runningCount: 0, finishedCount: 0 };
      rerender(<SessionTranscriptPane bottomInsetPx={64} nonDisplacingBottomInsetPx={8} />);
      expect(screen.getByTestId("message-list").getAttribute("data-bottom-inset-px")).toBe("64");
      expect(screen.queryByTestId("background-work-row-anchor")).toBeNull();
    } finally {
      rectSpy.mockRestore();
    }
  });
});
