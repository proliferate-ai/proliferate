// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

// Heavy leaf UI is not under test — the deferred content_stable hand-off is.
// The mock echoes the two inset props it received as data attributes so the
// carried R1 item 1 fix (dock-reactivity while the background-work row is
// visible) can be asserted without needing the real virtualized transcript.
vi.mock("#product/components/workspace/chat/transcript/MessageList", () => ({
  MessageList: (props: { bottomInsetPx: number; nonDisplacingBottomInsetPx: number }) => (
    <div
      data-testid="message-list"
      data-bottom-inset-px={props.bottomInsetPx}
      data-non-displacing-bottom-inset-px={props.nonDisplacingBottomInsetPx}
    />
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
    rehydrateSessionSlotFromHistory: vi.fn().mockResolvedValue(true),
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
function beginDeferredColdOpen(): void {
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
  putSessionRecord(
    createEmptySessionRecord(SESSION_ID, "codex", { workspaceId: WORKSPACE_ID }),
  );
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
  it("does NOT finish on the empty scaffold, then finishes once hydration lands", () => {
    beginDeferredColdOpen();
    renderPane();

    // Scaffold present (empty-but-truthy transcript) but transcriptHydrated is
    // still false: content_stable must not fire against the scaffold.
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

  // Review round 2 (geometry fix): the row is real content sitting ABOVE
  // MessageList's own reserved end-padding, not a scrim inside it — its own
  // height must be reserved too, or it paints over the last turn's tail.
  // jsdom's `getBoundingClientRect` returns all-zero rects by default, so this
  // test spies it to a fixed, nonzero row height to exercise the real
  // measure -> augment -> anchor wiring (the actual pixel geometry is proven
  // end-to-end by the throwaway Playwright fixture, not by this unit test).
  it("reserves the row's own measured height on top of the live bottomInsetPx, and anchors the row at the ORIGINAL structural share (not the raw bottomInsetPx)", () => {
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
      // structural = 64 - 8 = 56; augmented total fed to MessageList = 64 + 32 (row height).
      expect(messageList.getAttribute("data-bottom-inset-px")).toBe("96");
      expect(messageList.getAttribute("data-non-displacing-bottom-inset-px")).toBe("8");

      const rowAnchor = screen.getByTestId("background-work-row-anchor");
      // Anchored at the ORIGINAL structural share (56), not the raw
      // bottomInsetPx (64) — the delta is exactly the composer's own
      // nonDisplacing overlap zone (8), which the row must clear entirely.
      expect(rowAnchor.style.bottom).toBe("56px");
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
});
