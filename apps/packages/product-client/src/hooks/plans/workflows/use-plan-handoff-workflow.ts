import { useCallback, useMemo, useState } from "react";
import type {
  ContentPart,
  PromptInputBlock,
} from "@anyharness/sdk";
import { PLAN_HANDOFF_DEFAULT_PROMPT } from "#product/copy/plans/plan-prompts";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { useActiveSessionLaunchState } from "#product/hooks/chat/derived/use-active-session-config-state";
import { useChatLaunchCatalog } from "#product/hooks/chat/derived/use-chat-launch-catalog";
import { useConfiguredLaunchReadiness } from "#product/hooks/chat/derived/use-configured-launch-readiness";
import { useSessionCreationActions } from "#product/hooks/sessions/workflows/use-session-creation-actions";
import { useSessionDismissActions } from "#product/hooks/sessions/workflows/use-session-dismiss-actions";
import type { SessionActivationOutcome } from "#product/hooks/sessions/workflows/session-activation-guard";
import { useSessionPromptWorkflow } from "#product/hooks/sessions/workflows/use-session-prompt-workflow";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import type { PromptPlanAttachmentDescriptor } from "#product/domain/chats/composer/prompt-plan-attachments";
import { buildPlanHandoffPrompt } from "#product/lib/domain/plans/handoff-prompt";
import { buildLaunchControlDescriptors } from "#product/lib/domain/chat/models/launch-control-descriptors";
import type {
  ModelSelectorProps,
  ModelSelectorSelection,
} from "#product/lib/domain/chat/models/model-selector-types";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import type { PendingSessionConfigChanges } from "#product/domain/sessions/pending-config";
import { resolveModelDisplayName } from "#product/lib/domain/chat/models/model-display";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { getSessionRecord } from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import type { ToastErrorInput } from "#product/primitives/utils/toast-model";

// Owns the plan handoff dialog form and submit workflow wiring. Does not own session runtime.
export function usePlanHandoffWorkflow({
  plan,
  onCompleted,
}: {
  plan: PromptPlanAttachmentDescriptor;
  onCompleted: () => void;
}) {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const showToast = useToastStore((state) => state.show);
  const showErrorToast = useToastStore((state) => state.showError);
  const { currentLaunchIdentity } = useActiveSessionLaunchState();
  const configuredLaunch = useConfiguredLaunchReadiness(currentLaunchIdentity);
  const [promptText, setPromptText] = useState(PLAN_HANDOFF_DEFAULT_PROMPT);
  const [selection, setSelection] = useState<ModelSelectorSelection | null>(null);
  const [controlSelection, setControlSelection] = useState<{
    agentKind: string;
    values: Record<string, string>;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const launchCatalog = useChatLaunchCatalog({
    activeSelection: selection ?? configuredLaunch.selection,
  });
  const { hasAgents, isLoading: agentsLoading } = useAgentCatalog();
  const { createEmptySessionWithResolvedConfig } = useSessionCreationActions();
  const { dismissSession } = useSessionDismissActions();
  const { activateChatTab } = useWorkspaceShellActivation();
  const { promptSession } = useSessionPromptWorkflow();

  const resolvedConnectionState = selectedCloudRuntime.state?.phase === "ready"
    ? "healthy"
    : selectedCloudRuntime.state
      ? "connecting"
      : connectionState;

  const effectiveSelection = selection
    ?? launchCatalog.selectedLaunchSelection
    ?? configuredLaunch.selection;

  const currentModel = useMemo(() => {
    if (!effectiveSelection) {
      return null;
    }
    const agent = launchCatalog.launchAgents.find((candidate) =>
      candidate.kind === effectiveSelection.kind
    );
    const model = agent?.models.find((candidate) => candidate.id === effectiveSelection.modelId);
    return {
      kind: effectiveSelection.kind,
      displayName: resolveModelDisplayName({
        agentKind: effectiveSelection.kind,
        modelId: effectiveSelection.modelId,
        sourceLabels: [model?.displayName],
      }) ?? effectiveSelection.modelId,
      pendingState: null,
    };
  }, [effectiveSelection, launchCatalog.launchAgents]);

  const modelSelectorProps = useMemo<ModelSelectorProps>(() => ({
    connectionState: resolvedConnectionState,
    currentModel,
    groups: launchCatalog.groups,
    hasAgents,
    isLoading: agentsLoading || launchCatalog.isLoading,
    onSelect: setSelection,
  }), [
    agentsLoading,
    currentModel,
    hasAgents,
    launchCatalog.groups,
    launchCatalog.isLoading,
    resolvedConnectionState,
  ]);

  const launchControlDefaults = useMemo(() => Object.fromEntries(
    (launchCatalog.launchAgents
      .find((candidate) => candidate.kind === effectiveSelection?.kind)
      ?.launchControls ?? [])
      .flatMap((control) => control.defaultValue
        ? [[control.key, control.defaultValue] as const]
        : []),
  ), [effectiveSelection?.kind, launchCatalog.launchAgents]);
  const launchControlValues = useMemo(() => ({
    ...launchControlDefaults,
    ...(controlSelection?.agentKind === effectiveSelection?.kind
      ? controlSelection.values
      : {}),
  }), [controlSelection, effectiveSelection?.kind, launchControlDefaults]);
  const launchControlPending = useMemo<PendingSessionConfigChanges>(() =>
    Object.fromEntries(Object.entries(launchControlValues).map(([rawConfigId, value], index) => [
      rawConfigId,
      {
        rawConfigId,
        value,
        status: "settling" as const,
        mutationId: index,
      },
    ])), [launchControlValues]);
  const launchControls = useMemo<LiveSessionControlDescriptor[]>(() =>
    buildLaunchControlDescriptors({
      selection: effectiveSelection,
      launchAgents: launchCatalog.launchAgents,
      pendingConfigChanges: launchControlPending,
      onSelect: (agentKind, _controlKey, rawConfigId, value) => {
        setControlSelection({
          agentKind,
          values: {
            ...launchControlDefaults,
            ...(controlSelection && controlSelection.agentKind === agentKind
              ? controlSelection.values
              : {}),
            [rawConfigId]: value,
          },
        });
      },
    }), [
      controlSelection,
      effectiveSelection,
      launchCatalog.launchAgents,
      launchControlDefaults,
      launchControlPending,
    ]);

  const submit = useCallback(async function submit() {
    if (!selectedWorkspaceId) {
      return;
    }
    const launchSelection = effectiveSelection;
    if (!launchSelection) {
      showToast("Choose a ready model before handing off a plan.");
      return;
    }

    const prompt = buildPlanHandoffPrompt({ plan, text: promptText });
    setIsSubmitting(true);
    const previousActiveSessionId = useSessionSelectionStore.getState().activeSessionId;
    try {
      await executePlanHandoff({
        launchSelection,
        selectedWorkspaceId,
        launchControlValues,
        text: prompt.text,
        blocks: prompt.blocks,
        optimisticContentParts: prompt.optimisticContentParts,
        previousActiveSessionId,
        createEmptySessionWithResolvedConfig,
        promptSession,
        dismissSession,
        selectSession: (sessionId) => activateChatTab({
          workspaceId: selectedWorkspaceId,
          sessionId,
          source: "plan-handoff-restore",
        }),
        hasSession: (sessionId) =>
          !!getSessionRecord(sessionId),
        onCompleted,
        showErrorToast,
        retry: () => void submit(),
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    createEmptySessionWithResolvedConfig,
    dismissSession,
    effectiveSelection,
    onCompleted,
    plan,
    promptText,
    promptSession,
    launchControlValues,
    selectedWorkspaceId,
    showErrorToast,
    showToast,
  ]);

  return {
    submit,
    isSubmitting,
    promptText,
    setPromptText,
    modelSelectorProps,
    launchControls,
  };
}

interface ExecutePlanHandoffInput {
  launchSelection: ModelSelectorSelection;
  selectedWorkspaceId: string;
  launchControlValues: Record<string, string>;
  text: string;
  blocks: PromptInputBlock[];
  optimisticContentParts: ContentPart[];
  previousActiveSessionId: string | null;
  createEmptySessionWithResolvedConfig: (options: {
    agentKind: string;
    modelId: string;
    launchControlValues?: Record<string, string>;
    workspaceId: string;
  }) => Promise<string>;
  promptSession: (options: {
    sessionId: string;
    text: string;
    blocks: PromptInputBlock[];
    optimisticContentParts: ContentPart[];
    workspaceId: string;
  }) => Promise<void>;
  dismissSession: (sessionId: string) => Promise<boolean>;
  selectSession: (sessionId: string) => Promise<SessionActivationOutcome | void>;
  hasSession: (sessionId: string) => boolean;
  onCompleted: () => void;
  showErrorToast: (input: ToastErrorInput) => void;
  /** Re-run the handoff, for the error toast's Retry. */
  retry: () => void;
}

export async function executePlanHandoff({
  launchSelection,
  selectedWorkspaceId,
  launchControlValues,
  text,
  blocks,
  optimisticContentParts,
  previousActiveSessionId,
  createEmptySessionWithResolvedConfig,
  promptSession,
  dismissSession,
  selectSession,
  hasSession,
  onCompleted,
  showErrorToast,
  retry,
}: ExecutePlanHandoffInput): Promise<void> {
  let createdSessionId: string | null = null;
  try {
    createdSessionId = await createEmptySessionWithResolvedConfig({
      agentKind: launchSelection.kind,
      modelId: launchSelection.modelId,
      launchControlValues,
      workspaceId: selectedWorkspaceId,
    });
    await promptSession({
      sessionId: createdSessionId,
      text,
      blocks,
      optimisticContentParts,
      workspaceId: selectedWorkspaceId,
    });
    onCompleted();
  } catch (error) {
    if (createdSessionId) {
      await dismissSession(createdSessionId).catch(() => undefined);
      if (previousActiveSessionId && hasSession(previousActiveSessionId)) {
        await selectSession(previousActiveSessionId).catch(() => undefined);
      }
    }
    // The rollback above already dismissed the half-created session and put the
    // user back where they were, so the consequence can promise that plainly.
    showErrorToast({
      headline: "Plan not handed off",
      consequence: "No new chat was started and you are back in the session you were in.",
      cause: error instanceof Error ? error.message : String(error),
      retry,
    });
  }
}
