import { useCallback } from "react";
import type { ModelSelectorSelection } from "@/lib/domain/chat/model-selection";
import type { Workspace } from "@anyharness/sdk";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { isSessionModelAvailabilityInterruption } from "@/hooks/sessions/use-session-model-availability-workflow";
import { useCoworkThreadWorkflow } from "@/hooks/cowork/use-cowork-thread-workflow";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useActiveSessionLaunchState } from "./use-active-chat-session-selectors";
import {
  EMPTY_CHAT_DRAFT,
  serializeChatDraftToPrompt,
} from "@/lib/domain/chat/file-mentions";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/workspace-ui-key";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";

const EMPTY_WORKSPACES: Workspace[] = [];

export function useChatLaunchActions(options?: { suppressActiveSessionState?: boolean }) {
  const suppressActiveSessionState = options?.suppressActiveSessionState ?? false;
  const showToast = useToastStore((store) => store.show);
  const setWorkspaceArrivalEvent = useSessionSelectionStore((state) => state.setWorkspaceArrivalEvent);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const workspaceUiKey = resolveWorkspaceUiKey(selectedLogicalWorkspaceId, selectedWorkspaceId);
  const currentDraft = useChatInputStore((state) =>
    serializeChatDraftToPrompt(
      workspaceUiKey
        ? state.draftByWorkspaceId[workspaceUiKey] ?? EMPTY_CHAT_DRAFT
        : EMPTY_CHAT_DRAFT,
    ),
  );
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const { createEmptySessionWithResolvedConfig, setActiveSessionConfigOption } = useSessionActions();
  const { createThreadFromSelection } = useCoworkThreadWorkflow();
  const {
    activeSessionId,
    currentLaunchIdentity,
    currentModelConfigId,
  } = useActiveSessionLaunchState();
  const scopedActiveSessionId = suppressActiveSessionState ? null : activeSessionId;
  const scopedCurrentLaunchIdentity = suppressActiveSessionState ? null : currentLaunchIdentity;
  const scopedCurrentModelConfigId = suppressActiveSessionState ? null : currentModelConfigId;

  const handleLaunchSelect = useCallback((selection: ModelSelectorSelection) => {
    if (
      scopedCurrentLaunchIdentity?.kind === selection.kind
      && scopedCurrentLaunchIdentity.modelId === selection.modelId
    ) {
      return;
    }

    if (
      scopedActiveSessionId
      && scopedCurrentLaunchIdentity?.kind === selection.kind
      && scopedCurrentModelConfigId
    ) {
      void setActiveSessionConfigOption(scopedCurrentModelConfigId, selection.modelId)
        .then(() => {
          setWorkspaceArrivalEvent(null);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          showToast(`Failed to switch model: ${message}`);
      });
      return;
    }

    if (selectedWorkspace?.surface === "cowork") {
      const latencyFlowId = startLatencyFlow({
        flowKind: "session_create",
        source: "model_selector",
        targetWorkspaceId: selectedWorkspaceId,
      });
      void createThreadFromSelection({
        agentKind: selection.kind,
        modelId: selection.modelId,
        draftText: currentDraft,
        sourceWorkspaceId: selectedWorkspaceId,
      })
        .then(() => {
          setWorkspaceArrivalEvent(null);
        })
        .catch((error) => {
          failLatencyFlow(latencyFlowId, "session_create_failed");
          const message = error instanceof Error ? error.message : String(error);
          showToast(`Failed to open chat: ${message}`);
        });
      return;
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "session_create",
      source: "model_selector",
      targetWorkspaceId: selectedWorkspaceId,
    });
    void createEmptySessionWithResolvedConfig({
      agentKind: selection.kind,
      modelId: selection.modelId,
      latencyFlowId,
    })
      .then(() => {
        setWorkspaceArrivalEvent(null);
      })
      .catch((error) => {
        if (isSessionModelAvailabilityInterruption(error)) {
          return;
        }
        failLatencyFlow(latencyFlowId, "session_create_failed");
        const message = error instanceof Error ? error.message : String(error);
        showToast(`Failed to open chat: ${message}`);
      });
  }, [
    createThreadFromSelection,
    currentDraft,
    createEmptySessionWithResolvedConfig,
    selectedWorkspace?.surface,
    selectedWorkspaceId,
    setActiveSessionConfigOption,
    setWorkspaceArrivalEvent,
    showToast,
    scopedActiveSessionId,
    scopedCurrentLaunchIdentity,
    scopedCurrentModelConfigId,
  ]);

  return {
    handleLaunchSelect,
  };
}
