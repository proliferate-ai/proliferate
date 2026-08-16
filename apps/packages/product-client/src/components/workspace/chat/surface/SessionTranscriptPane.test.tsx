// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
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
vi.mock("#product/components/workspace/chat/transcript/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
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
