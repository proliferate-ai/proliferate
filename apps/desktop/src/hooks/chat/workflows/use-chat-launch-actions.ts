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
import { useConfiguredLaunchReadiness } from "@/hooks/chat/derived/use-configured-launch-readiness";
import { resolveAvailableLaunchSelection } from "@/lib/domain/chat/models/launch-selection-defaults";
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
  // PERF: read the draft imperatively at launch time. A reactive subscription
  // here re-rendered this hook's consumers (useChatModelSelectorState →
  // ChatInput, ~20 hooks) on EVERY keystroke — the draft is only needed when
  // the user actually picks a launch option.
  const getCurrentDraftText = useCallback((): string => {
    return serializeChatDraftToPrompt(
      workspaceUiKey
        ? useChatInputStore.getState().draftByWorkspaceId[workspaceUiKey] ?? EMPTY_CHAT_DRAFT
        : EMPTY_CHAT_DRAFT,
    );
  }, [workspaceUiKey]);
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
  const configuredLaunch = useConfiguredLaunchReadiness(scopedCurrentLaunchIdentity);

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
    ) {
      // Same-harness switch always keeps the session (decision 10). The
      // runtime accepts catalog-authorized values beyond the live option
      // list and falls back to relaunching the agent process under the same
      // session when the harness has no live mechanism. "model" is the
      // generic model config id when the session exposes no control.
      void setActiveSessionConfigOption(scopedCurrentModelConfigId ?? "model", selection.modelId)
        .then(() => {
          setWorkspaceArrivalEvent(null);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          showToast(`Failed to switch model: ${message}`);
        });
      return;
    }

    const launchSelection = resolveAvailableLaunchSelection(
      configuredLaunch.launchCatalog.launchAgents,
      selection,
      null,
    );
    if (!launchSelection) {
      showToast(configuredLaunch.disabledReason ?? "Choose a ready model before opening a new chat.");
      return;
    }

    if (selectedWorkspace?.surface === "cowork") {
      const latencyFlowId = startLatencyFlow({
        flowKind: "session_create",
        source: "model_selector",
        targetWorkspaceId: selectedWorkspaceId,
      });
      void createThreadFromSelection({
        agentKind: launchSelection.kind,
        modelId: launchSelection.modelId,
        draftText: getCurrentDraftText(),
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
      agentKind: launchSelection.kind,
      modelId: launchSelection.modelId,
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
    configuredLaunch.disabledReason,
    configuredLaunch.launchCatalog.launchAgents,
    createThreadFromSelection,
    getCurrentDraftText,
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
