// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

// Heavy leaf UI is not under test — the deferred content_stable hand-off is,
// plus (bgwork r6 round 2) the pane's remaining background-work responsibility:
// forwarding the live running count and completion receipts down as MessageList
// props. The row and receipts are now real in-scroll transcript rows rendered
// INSIDE MessageList (covered by the transcript-row-model + MessageList tests),
// so the pane no longer floats a band or augments the inset to reserve one. The
// mock echoes the props it receives as data attributes.
vi.mock("#product/components/workspace/chat/transcript/MessageList", () => ({
  MessageList: (props: {
    bottomInsetPx: number;
    nonDisplacingBottomInsetPx: number;
    backgroundWorkRunningCount?: number;
    completionReceipts?: readonly { key: string }[];
  }) => (
    <div
      data-testid="message-list"
      data-bottom-inset-px={props.bottomInsetPx}
      data-non-displacing-bottom-inset-px={props.nonDisplacingBottomInsetPx}
      data-background-work-running-count={props.backgroundWorkRunningCount ?? 0}
      data-completion-receipt-count={props.completionReceipts?.length ?? 0}
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
  rowCounts: { runningCount: 0, finishedCount: 0 },
}));
// The pane's only remaining background-work read is the live running count it
// forwards to MessageList; the open-pane actions moved down to MessageList
// alongside the rows themselves (covered by use-open-background-work-pane.test
// and the MessageList render path).
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

describe("SessionTranscriptPane background-work wiring (in-flow rows, bgwork r6 round 2)", () => {
  it("passes the live, unclamped bottomInsetPx/nonDisplacingBottomInsetPx straight through to MessageList — the running-count row is now an in-scroll transcript row, so the pane no longer augments the inset to reserve a floating band", () => {
    backgroundWorkMocks.rowCounts = { runningCount: 2, finishedCount: 0 };
    beginDeferredColdOpen();
    render(<SessionTranscriptPane bottomInsetPx={64} nonDisplacingBottomInsetPx={8} />);

    const messageList = screen.getByTestId("message-list");
    // Unaugmented: exactly the props it was handed (round-2 supersedes the R2
    // inset-reserve that used to add the measured row height here).
    expect(messageList.getAttribute("data-bottom-inset-px")).toBe("64");
    expect(messageList.getAttribute("data-non-displacing-bottom-inset-px")).toBe("8");
  });

  it("threads the live running count down to MessageList, which renders the tail footer row in-flow", () => {
    backgroundWorkMocks.rowCounts = { runningCount: 2, finishedCount: 0 };
    beginDeferredColdOpen();
    render(<SessionTranscriptPane bottomInsetPx={0} nonDisplacingBottomInsetPx={0} />);

    expect(
      screen.getByTestId("message-list").getAttribute("data-background-work-running-count"),
    ).toBe("2");
  });

  it("passes the same plain inset through and a zero running count when there is no background work — no floating band, no reserved padding", () => {
    backgroundWorkMocks.rowCounts = { runningCount: 0, finishedCount: 0 };
    beginDeferredColdOpen();
    render(<SessionTranscriptPane bottomInsetPx={64} nonDisplacingBottomInsetPx={8} />);

    const messageList = screen.getByTestId("message-list");
    expect(messageList.getAttribute("data-bottom-inset-px")).toBe("64");
    expect(messageList.getAttribute("data-non-displacing-bottom-inset-px")).toBe("8");
    expect(messageList.getAttribute("data-background-work-running-count")).toBe("0");
    // Negative control: the retired R1/R2 floating band anchor is gone — the
    // pane no longer renders any background-work element of its own.
    expect(screen.queryByTestId("background-work-row-anchor")).toBeNull();
  });

  it("forwards the session's completion receipts (empty with no observed completions) as a MessageList prop rather than rendering them itself", () => {
    backgroundWorkMocks.rowCounts = { runningCount: 0, finishedCount: 0 };
    beginDeferredColdOpen();
    render(<SessionTranscriptPane bottomInsetPx={0} nonDisplacingBottomInsetPx={0} />);

    expect(
      screen.getByTestId("message-list").getAttribute("data-completion-receipt-count"),
    ).toBe("0");
  });
});
