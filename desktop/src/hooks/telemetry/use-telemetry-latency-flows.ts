import { useEffect } from "react";
import { useActiveSessionSurfaceSnapshot } from "@/hooks/chat/use-active-chat-session-selectors";
import { useChatSurfaceState } from "@/hooks/chat/use-chat-surface-state";
import {
  finishLatencyFlow,
  type LatencyFlowRecord,
  type LatencyFlowStage,
  listActiveLatencyFlows,
} from "@/lib/infra/latency-flow";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

function isSurfaceReady(modeKind: string): boolean {
  return modeKind !== "no-workspace" && modeKind !== "session-loading";
}

interface TelemetryLatencyFlowState {
  activeFlows: LatencyFlowRecord[];
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
  sessionViewState: string;
  modeKind: string;
}

interface LatencyFlowCompletion {
  flowId: string;
  stage: Extract<LatencyFlowStage, "optimistic_visible" | "processing_started" | "surface_ready">;
}

export function collectTelemetryLatencyFlowCompletions(
  state: TelemetryLatencyFlowState,
): LatencyFlowCompletion[] {
  const completions: LatencyFlowCompletion[] = [];

  for (const flow of state.activeFlows) {
    switch (flow.flowKind) {
      case "prompt_submit": {
        // `optimistic_visible` = server acknowledged intent. For the prompt
        // submit flow this fires as soon as the target session view state
        // becomes working/needs_input, which the client learns via either
        // the HTTP 200 ack applying a status patch, or the first SSE event.
        // `processing_started` = server is actively processing this prompt's
        // turn, which maps to the same working/needs_input transition. In
        // the current flow helpers these are emitted sequentially by
        // `finishLatencyFlow`, so we only publish the terminal "processing
        // started" signal and rely on the helper to collapse stages for the
        // non-queued case.
        if (
          flow.targetSessionId === state.activeSessionId
          && (state.sessionViewState === "working" || state.sessionViewState === "needs_input")
        ) {
          completions.push({
            flowId: flow.flowId,
            stage: "processing_started",
          });
        }
        break;
      }
      case "session_create":
      case "session_restore":
      case "session_switch": {
        if (
          flow.targetSessionId !== null
          && flow.targetSessionId.trim().length > 0
          && flow.targetSessionId === state.activeSessionId
          && isSurfaceReady(state.modeKind)
        ) {
          completions.push({
            flowId: flow.flowId,
            stage: "surface_ready",
          });
        }
        break;
      }
      case "workspace_switch":
      case "worktree_enter": {
        if (
          flow.targetWorkspaceId === state.selectedWorkspaceId
          && isSurfaceReady(state.modeKind)
        ) {
          completions.push({
            flowId: flow.flowId,
            stage: "surface_ready",
          });
        }
        break;
      }
    }
  }

  return completions;
}

export function useTelemetryLatencyFlows() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const { mode } = useChatSurfaceState();
  const {
    activeSessionId,
    sessionViewState,
  } = useActiveSessionSurfaceSnapshot();

  useEffect(() => {
    const completions = collectTelemetryLatencyFlowCompletions({
      activeFlows: listActiveLatencyFlows(),
      selectedWorkspaceId,
      activeSessionId,
      sessionViewState,
      modeKind: mode.kind,
    });
    for (const completion of completions) {
      finishLatencyFlow(completion.flowId, completion.stage);
    }
  }, [
    activeSessionId,
    mode.kind,
    selectedWorkspaceId,
    sessionViewState,
  ]);
}
