import { useCallback } from "react";
import type { ModelSelectorSelection } from "#product/lib/domain/chat/models/model-selector-types";
import type { Workspace } from "@anyharness/sdk";
import { useSessionCreationActions } from "#product/hooks/sessions/workflows/use-session-creation-actions";
import {
  formatSessionCreateFailureMessage,
  isWorkspaceDirectoryMissingError,
} from "#product/lib/domain/sessions/creation/create-session-error";
import {
  readModelSupportRefusal,
  type ModelSupportRefusal,
} from "#product/lib/domain/chat/models/model-support-refusals";
import { useModelSupportStore } from "#product/stores/chat/model-support-store";
import { ANYHARNESS_UPDATE_DOCS_URL } from "#product/config/capabilities";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { workspaceDisplayName } from "#product/lib/domain/workspaces/display/workspace-display";
import type { ToastErrorInput } from "#product/primitives/utils/toast-model";
import { useSessionConfigActions } from "#product/hooks/sessions/workflows/use-session-config-actions";
import { useCoworkThreadLaunchContext } from "#product/providers/CoworkThreadLaunchProvider";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { useActiveSessionLaunchState } from "#product/hooks/chat/derived/use-active-session-config-state";
import { useConfiguredLaunchReadiness } from "#product/hooks/chat/derived/use-configured-launch-readiness";
import { resolveAvailableLaunchSelection } from "#product/lib/domain/chat/models/launch-selection-defaults";
import { EMPTY_CHAT_DRAFT } from "#product/lib/domain/chat/composer/file-mention-draft-model";
import { serializeChatDraftToOutgoingPrompt } from "#product/lib/domain/chat/composer/outgoing-prompt";
import { resolveWorkspaceUiKey } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "#product/lib/infra/measurement/measurement-port";
import { withUpdatedDefaultModelIdByAgentKind } from "#product/lib/domain/agents/model-options";

const EMPTY_WORKSPACES: Workspace[] = [];

export function useChatLaunchActions(options?: {
  suppressActiveSessionState?: boolean;
  replacementSessionId?: string | null;
}) {
  const suppressActiveSessionState = options?.suppressActiveSessionState ?? false;
  const replacementSessionId = options?.replacementSessionId ?? null;
  const showToast = useToastStore((store) => store.show);
  const showErrorToast = useToastStore((store) => store.showError);
  const recordModelSupportRefusal = useModelSupportStore((store) => store.recordRefusal);
  const requestModelPicker = useModelSupportStore((store) => store.requestPicker);
  const setWorkspaceArrivalEvent = useSessionSelectionStore((state) => state.setWorkspaceArrivalEvent);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const workspaceUiKey = resolveWorkspaceUiKey(selectedLogicalWorkspaceId, selectedWorkspaceId);
  // PERF: read the draft imperatively at launch time. A reactive subscription
  // here re-rendered this hook's consumers (useChatModelSelectorState →
  // ChatInput, ~20 hooks) on EVERY keystroke — the draft is only needed when
  // the user actually picks a launch option.
  const getCurrentDraftText = useCallback((): string => {
    return serializeChatDraftToOutgoingPrompt(
      workspaceUiKey
        ? useChatInputStore.getState().draftByWorkspaceId[workspaceUiKey] ?? EMPTY_CHAT_DRAFT
        : EMPTY_CHAT_DRAFT,
    );
  }, [workspaceUiKey]);
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const selectedWorkspaceLabel = selectedWorkspace
    ? workspaceDisplayName(selectedWorkspace)
    : null;
  const { openExternal } = useProductHost().links;
  const { createEmptySessionWithResolvedConfig } = useSessionCreationActions();
  const { setActiveSessionConfigOption } = useSessionConfigActions();
  const { desktopTargetsAvailable, createThreadFromSelection } =
    useCoworkThreadLaunchContext();
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

  const handleLaunchSelect = useCallback(function handleLaunchSelect(
    selection: ModelSelectorSelection,
  ) {
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
      // Same-harness selection preserves the durable session. The runtime
      // validates the value against this session's canonical live snapshot,
      // then requires exact setter readback. "model" is the generic config id
      // when the session exposes no raw model control.
      void setActiveSessionConfigOption(scopedCurrentModelConfigId ?? "model", selection.modelId)
        .then(() => {
          setWorkspaceArrivalEvent(null);
        })
        .catch((error) => {
          // The picker has already closed over the choice the user made, so the
          // toast is the only place left that can name it. Retry re-runs the
          // same selection rather than only reporting that it did not take.
          showErrorToast({
            headline: "Model not switched",
            consequence: `This session is still on its previous model, not ${selection.modelId}.`,
            cause: error instanceof Error ? error.message : String(error),
            retry: () => handleLaunchSelect(selection),
          });
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

    // Last-used-wins: persist the selection so subsequent new chats default to it.
    persistLastUsedLaunchSelection(launchSelection);

    if (selectedWorkspace?.surface === "cowork") {
      if (!desktopTargetsAvailable) {
        showToast("Cowork threads are available in the Desktop app.", "info");
        return;
      }
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
          reportChatOpenFailure(error, launchSelection, {
            workspaceId: selectedWorkspaceId,
            workspaceLabel: selectedWorkspaceLabel,
            openExternal,
            recordRefusal: recordModelSupportRefusal,
            requestPicker: requestModelPicker,
            showErrorToast,
            retry: () => handleLaunchSelect(launchSelection),
          });
        });
      return;
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "session_create",
      source: "model_selector",
      targetWorkspaceId: selectedWorkspaceId,
    });
    // Pass the current session as replacesSessionId: the creation workflow
    // hides an unused old shell synchronously, then commits its cleanup only
    // after the optimistic replacement materializes.
    void createEmptySessionWithResolvedConfig({
      agentKind: launchSelection.kind,
      modelId: launchSelection.modelId,
      latencyFlowId,
      // Presentation suppression hides stale config/model state while a
      // pending shell is projected; it must not erase the shell being replaced.
      replacesSessionId: replacementSessionId ?? scopedActiveSessionId ?? null,
    })
      .then(() => {
        setWorkspaceArrivalEvent(null);
      })
      .catch((error) => {
        failLatencyFlow(latencyFlowId, "session_create_failed");
        reportChatOpenFailure(error, launchSelection, {
          workspaceId: selectedWorkspaceId,
          workspaceLabel: selectedWorkspaceLabel,
          openExternal,
          recordRefusal: recordModelSupportRefusal,
          requestPicker: requestModelPicker,
          showErrorToast,
          retry: () => handleLaunchSelect(launchSelection),
        });
      });
  }, [
    configuredLaunch.disabledReason,
    configuredLaunch.launchCatalog.launchAgents,
    createThreadFromSelection,
    getCurrentDraftText,
    createEmptySessionWithResolvedConfig,
    selectedWorkspace?.surface,
    selectedWorkspaceId,
    desktopTargetsAvailable,
    setActiveSessionConfigOption,
    setWorkspaceArrivalEvent,
    showErrorToast,
    showToast,
    scopedActiveSessionId,
    scopedCurrentLaunchIdentity,
    scopedCurrentModelConfigId,
    scopedModelControl,
    replacementSessionId,
    openExternal,
    recordModelSupportRefusal,
    requestModelPicker,
    selectedWorkspaceLabel,
  ]);

  return {
    handleLaunchSelect,
  };
}

interface ChatOpenFailureDeps {
  workspaceId: string | null;
  workspaceLabel: string | null;
  openExternal: (url: string) => void | Promise<unknown>;
  recordRefusal: (refusal: ModelSupportRefusal) => void;
  requestPicker: () => void;
  showErrorToast: (input: ToastErrorInput) => void;
  retry: () => void;
}

/**
 * The one place a failed chat-open is reported.
 *
 * A refused model is recorded before anything is said, so the picker's rows are
 * already marked by the time the user opens it: the toast's suggestion to pick
 * another model lands on a menu that shows which one is the problem instead of
 * one that looks unchanged.
 *
 * The refusal case carries no Retry. Retrying the same model against the same
 * target cannot succeed, and a button that is guaranteed to fail is worse than
 * no button — the way out is a different model or a newer runtime, which is what
 * the marked rows and the update link are for.
 *
 * Module-level rather than a `useCallback`, because the generic branch's retry
 * re-enters `handleLaunchSelect`: a hook-level callback would have to close over
 * a binding declared after it.
 */
function reportChatOpenFailure(
  error: unknown,
  selection: ModelSelectorSelection,
  deps: ChatOpenFailureDeps,
): void {
  // The missing-worktree composer panel owns that condition — no toast.
  if (isWorkspaceDirectoryMissingError(error)) {
    return;
  }

  const refusal = readModelSupportRefusal(error, {
    workspaceId: deps.workspaceId,
    selection,
  });
  if (refusal) {
    deps.recordRefusal(refusal);
    // Same id per model+target: a user who picks the same refused model twice
    // gets the one toast replaced, not a second copy of it.
    deps.showErrorToast({
      id: `model-unsupported:${refusal.workspaceId}:${refusal.agentKind}:${refusal.modelId}`,
      // A headline is a written literal, so the specific model and target live
      // in the consequence — the field built to name them.
      headline: "That model was refused",
      // States the refusal, not a diagnosis of it: nothing in the catalog carries
      // a per-model minimum runtime version, so "needs a newer AnyHarness"
      // asserted a cause no surface can confirm, and a stale catalog entry lands
      // here just as easily as an old runtime. The docs link below still offers
      // the upgrade as something to try; it just no longer arrives as a finding.
      consequence: deps.workspaceLabel
        ? `${deps.workspaceLabel} refused ${selection.modelId}. Your model setting wasn't changed.`
        : `This target refused ${selection.modelId}. Your model setting wasn't changed.`,
      cause: refusal.detail,
      // Docs as the `link`, not as Details: Details is where the runtime's own
      // refusal text lives, and both are worth having — one says what to do,
      // the other is what a user pastes into a bug report.
      link: {
        label: "How to update",
        onClick: () => {
          void deps.openExternal(ANYHARNESS_UPDATE_DOCS_URL);
        },
      },
    });
    deps.requestPicker();
    return;
  }

  deps.showErrorToast({
    headline: "Chat not opened",
    consequence: deps.workspaceLabel
      ? `No new chat was started in ${deps.workspaceLabel}. Your draft is still in the composer.`
      : "No new chat was started. Your draft is still in the composer.",
    cause: formatSessionCreateFailureMessage(error),
    retry: deps.retry,
  });
}

/**
 * Last-used-wins: persists the user's agent+model selection so the next new
 * chat defaults to it (replacing the deleted "Agent Defaults" settings page).
 */
function persistLastUsedLaunchSelection(selection: ModelSelectorSelection): void {
  const state = useUserPreferencesStore.getState();
  state.setMultiple({
    defaultChatAgentKind: selection.kind,
    defaultChatModelIdByAgentKind: withUpdatedDefaultModelIdByAgentKind(
      state.defaultChatModelIdByAgentKind,
      selection.kind,
      selection.modelId,
    ),
  });
}
