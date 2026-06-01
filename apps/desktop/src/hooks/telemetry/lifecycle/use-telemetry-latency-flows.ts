import { useEffect } from "react";
import { useActiveSessionSurfaceSnapshot } from "@/hooks/chat/derived/use-active-session-transcript-state";
import { useChatSurfaceState } from "@/hooks/chat/derived/use-chat-surface-state";
import {
  finishLatencyFlow,
  listActiveLatencyFlows,
} from "@/lib/infra/measurement/latency-flow";
import { collectTelemetryLatencyFlowCompletions } from "@/lib/domain/telemetry/latency-flow-completion";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

// Owns finishing telemetry latency flows when the visible app state catches up.
// Does not own latency-flow stage planning; that pure decision lives in domain telemetry.
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
