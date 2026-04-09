import { useEffect } from "react";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useChatSurfaceState } from "@/hooks/chat/use-chat-surface-state";
import {
  finishLatencyFlow,
  type LatencyFlowRecord,
  type LatencyFlowStage,
  listActiveLatencyFlows,
} from "@/lib/infra/latency-flow";
import type { PendingUserPrompt } from "@/stores/sessions/harness-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";

function isSurfaceReady(modeKind: string): boolean {
  return modeKind !== "no-workspace" && modeKind !== "session-loading";
}

interface TelemetryLatencyFlowState {
  activeFlows: LatencyFlowRecord[];
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
  pendingUserPrompt: PendingUserPrompt | null;
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
        if (
          state.pendingUserPrompt?.flowId === flow.flowId
          && (!flow.promptId || state.pendingUserPrompt.promptId === flow.promptId)
        ) {
          completions.push({
            flowId: flow.flowId,
            stage: "optimistic_visible",
          });
        }

        if (
          flow.targetSessionId === state.activeSessionId
          && state.pendingUserPrompt?.flowId !== flow.flowId
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
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { mode } = useChatSurfaceState();
  const {
    activeSessionId,
    pendingUserPrompt,
    sessionViewState,
  } = useActiveChatSessionState();

  useEffect(() => {
    const completions = collectTelemetryLatencyFlowCompletions({
      activeFlows: listActiveLatencyFlows(),
      selectedWorkspaceId,
      activeSessionId,
      pendingUserPrompt,
      sessionViewState,
      modeKind: mode.kind,
    });
    for (const completion of completions) {
      finishLatencyFlow(completion.flowId, completion.stage);
    }
  }, [
    activeSessionId,
    mode.kind,
    pendingUserPrompt?.flowId,
    pendingUserPrompt?.promptId,
    selectedWorkspaceId,
    sessionViewState,
  ]);
}
