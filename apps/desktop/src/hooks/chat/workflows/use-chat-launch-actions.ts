import { useCallback } from "react";
import type { ModelSelectorSelection } from "@/lib/domain/chat/models/model-selector-types";
import type { Workspace } from "@anyharness/sdk";
import { useSessionCreationActions } from "@/hooks/sessions/workflows/use-session-creation-actions";
import { formatSessionCreateToastMessage } from "@/lib/domain/sessions/creation/create-session-error";
import { useSessionConfigActions } from "@/hooks/sessions/workflows/use-session-config-actions";
import { useCoworkThreadWorkflow } from "@/hooks/cowork/workflows/use-cowork-thread-workflow";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useActiveSessionLaunchState } from "@/hooks/chat/derived/use-active-session-config-state";
import {
  EMPTY_CHAT_DRAFT,
  serializeChatDraftToPrompt,
} from "@/lib/domain/chat/composer/file-mention-draft-model";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/selection/workspace-ui-key";
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
  const { createEmptySessionWithResolvedConfig } = useSessionCreationActions();
  const { setActiveSessionConfigOption } = useSessionConfigActions();
  const { createThreadFromSelection } = useCoworkThreadWorkflow();
  const {
    activeSessionId,
    currentLaunchIdentity,
    currentModelConfigId,
    modelControl,
  } = useActiveSessionLaunchState();
  const scopedActiveSessionId = suppressActiveSessionState ? null : activeSessionId;
  const scopedCurrentLaunchIdentity = suppressActiveSessionState ? null : currentLaunchIdentity;
  const scopedCurrentModelConfigId = suppressActiveSessionState ? null : currentModelConfigId;
  const scopedModelControl = suppressActiveSessionState ? null : modelControl;

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
      && (
        !scopedModelControl
        || scopedModelControl.values.some((value) => value.value === selection.modelId)
      )
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
          showToast(formatSessionCreateToastMessage(error, "Failed to open chat"));
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
        failLatencyFlow(latencyFlowId, "session_create_failed");
        showToast(formatSessionCreateToastMessage(error, "Failed to open chat"));
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
    scopedModelControl,
  ]);

  return {
    handleLaunchSelect,
  };
}
