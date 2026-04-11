import { useReplaceWorkspaceDefaultSessionMutation } from "@anyharness/sdk-react";
import { useCallback } from "react";
import type { ModelSelectorSelection } from "@/lib/domain/chat/model-selection";
import { resolveChatLaunchAction } from "@/lib/domain/chat/launch-policy";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useSelectedWorkspace } from "@/hooks/workspaces/use-selected-workspace";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useActiveChatSessionState } from "./use-active-chat-session-state";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

export function useChatLaunchActions() {
  const showToast = useToastStore((store) => store.show);
  const setWorkspaceArrivalEvent = useHarnessStore((state) => state.setWorkspaceArrivalEvent);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { isCoworkWorkspaceSelected } = useSelectedWorkspace();
  const replaceDefaultSession = useReplaceWorkspaceDefaultSessionMutation({
    workspaceId: selectedWorkspaceId,
  });
  const {
    openWorkspaceSessionWithResolvedConfig,
    selectSession,
    setActiveSessionConfigOption,
  } = useSessionActions();
  const {
    activeSessionId,
    currentLaunchIdentity,
    currentModelConfigId,
  } = useActiveChatSessionState();

  const handleLaunchSelect = useCallback((selection: ModelSelectorSelection) => {
    const action = resolveChatLaunchAction({
      isCoworkWorkspaceSelected,
      activeSessionId,
      currentLaunchIdentity,
      currentModelConfigId,
      selection,
    });

    if (action === "noop") {
      return;
    }

    if (action === "mutate-current-session") {
      void setActiveSessionConfigOption(currentModelConfigId!, selection.modelId)
        .then(() => {
          setWorkspaceArrivalEvent(null);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          showToast(`Failed to switch model: ${message}`);
        });
      return;
    }

    if (action === "replace-cowork-session") {
      if (!selectedWorkspaceId) {
        showToast("Select a Cowork thread before changing agents.");
        return;
      }

      void replaceDefaultSession.mutateAsync({
        agentKind: selection.kind,
        modelId: selection.modelId,
      }).then((result) => {
        setWorkspaceArrivalEvent(null);
        return selectSession(result.session.id, { allowColdIdleNoStream: true });
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        showToast(`Failed to replace Cowork session: ${message}`);
      });
      return;
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "session_create",
      source: "model_selector",
      targetWorkspaceId: selectedWorkspaceId,
    });
    void openWorkspaceSessionWithResolvedConfig({
      agentKind: selection.kind,
      modelId: selection.modelId,
      latencyFlowId,
    })
      .then(() => {
        setWorkspaceArrivalEvent(null);
      })
      .catch((error) => {
        failLatencyFlow(latencyFlowId, "session_create_failed");
        const message = error instanceof Error ? error.message : String(error);
        showToast(`Failed to open chat: ${message}`);
      });
  }, [
    activeSessionId,
    currentLaunchIdentity,
    currentModelConfigId,
    isCoworkWorkspaceSelected,
    openWorkspaceSessionWithResolvedConfig,
    replaceDefaultSession,
    selectedWorkspaceId,
    selectSession,
    setActiveSessionConfigOption,
    setWorkspaceArrivalEvent,
    showToast,
  ]);

  return {
    handleLaunchSelect,
  };
}
