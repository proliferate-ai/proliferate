import { useCallback, useMemo, useState } from "react";
import type {
  ContentPart,
  NormalizedSessionControl,
  PromptInputBlock,
} from "@anyharness/sdk";
import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { PLAN_HANDOFF_DEFAULT_PROMPT } from "@/copy/plans/plan-prompts";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { useActiveSessionLaunchState } from "@/hooks/chat/use-active-chat-session-selectors";
import { useChatLaunchCatalog } from "@/hooks/chat/use-chat-launch-catalog";
import { useConfiguredLaunchReadiness } from "@/hooks/chat/use-configured-launch-readiness";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import type { SessionActivationOutcome } from "@/hooks/sessions/session-activation-guard";
import { isSessionModelAvailabilityInterruption } from "@/hooks/sessions/use-session-model-availability-workflow";
import { useSessionPromptWorkflow } from "@/hooks/sessions/use-session-prompt-workflow";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import {
  planReferenceContentPartFromDescriptor,
  type PromptPlanAttachmentDescriptor,
} from "@/lib/domain/chat/prompt-content";
import {
  listPlanHandoffModeOptions,
  resolvePlanHandoffModeId,
  resolvePlanHandoffModeIdFromOptions,
  resolvePlanHandoffPrePromptConfigChanges,
} from "@/lib/domain/plans/handoff-mode";
import type {
  ModelSelectorProps,
  ModelSelectorSelection,
} from "@/lib/domain/chat/model-selection";
import { resolveModelDisplayName } from "@/lib/domain/chat/model-display";
import { getSessionClientAndWorkspace } from "@/lib/integrations/anyharness/session-runtime";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

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
  const { currentLaunchIdentity } = useActiveSessionLaunchState();
  const configuredLaunch = useConfiguredLaunchReadiness(currentLaunchIdentity);
  const [promptText, setPromptText] = useState(PLAN_HANDOFF_DEFAULT_PROMPT);
  const [selection, setSelection] = useState<ModelSelectorSelection | null>(null);
  const [modeOverrideId, setModeOverrideId] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const launchCatalog = useChatLaunchCatalog({
    activeSelection: selection ?? configuredLaunch.selection,
  });
  const { hasAgents, isLoading: agentsLoading, notReadyAgents } = useAgentCatalog();
  const {
    createEmptySessionWithResolvedConfig,
    dismissSession,
  } = useSessionActions();
  const { activateChatTab } = useWorkspaceShellActivation();
  const { promptSession } = useSessionPromptWorkflow();

  const resolvedConnectionState = selectedCloudRuntime.state?.phase === "ready"
    ? connectionState
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
    notReadyAgents,
    onSelect: setSelection,
  }), [
    agentsLoading,
    currentModel,
    hasAgents,
    launchCatalog.groups,
    launchCatalog.isLoading,
    notReadyAgents,
    resolvedConnectionState,
  ]);

  const modeOptions = useMemo(
    () => listPlanHandoffModeOptions(effectiveSelection?.kind),
    [effectiveSelection?.kind],
  );
  const defaultModeId = useMemo(
    () => resolvePlanHandoffModeId(effectiveSelection?.kind),
    [effectiveSelection?.kind],
  );
  const selectedModeId = modeOptions.some((option) => option.value === modeOverrideId)
    ? modeOverrideId
    : resolvePlanHandoffModeIdFromOptions(defaultModeId, modeOptions);
  const modePickerProps = useMemo(() => ({
    options: modeOptions,
    value: selectedModeId,
    onChange: setModeOverrideId,
  }), [modeOptions, selectedModeId]);

  const submit = useCallback(async () => {
    if (!selectedWorkspaceId) {
      return;
    }
    const launchSelection = effectiveSelection;
    if (!launchSelection) {
      showToast("Choose a ready model before handing off a plan.");
      return;
    }

    const trimmedText = promptText.trim();
    const blocks: PromptInputBlock[] = [
      ...(trimmedText ? [{ type: "text" as const, text: trimmedText }] : []),
      {
        type: "plan_reference",
        planId: plan.planId,
        snapshotHash: plan.snapshotHash,
      },
    ];
    const optimisticContentParts: ContentPart[] = [
      ...(trimmedText ? [{ type: "text" as const, text: trimmedText }] : []),
      planReferenceContentPartFromDescriptor(plan),
    ];
    setIsSubmitting(true);
    const previousActiveSessionId = useSessionSelectionStore.getState().activeSessionId;
    try {
      await executePlanHandoff({
        launchSelection,
        selectedWorkspaceId,
        selectedModeId,
        text: trimmedText,
        blocks,
        optimisticContentParts,
        previousActiveSessionId,
        createEmptySessionWithResolvedConfig,
        applyPrePromptConfigChanges: (sessionId) =>
          applyPlanHandoffPrePromptConfigChanges(
            sessionId,
            currentCollaborationModeForSession(sessionId),
          ),
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
        showToast,
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
    selectedModeId,
    selectedWorkspaceId,
    showToast,
  ]);

  return {
    submit,
    isSubmitting,
    promptText,
    setPromptText,
    modelSelectorProps,
    modePickerProps,
  };
}

interface ExecutePlanHandoffInput {
  launchSelection: ModelSelectorSelection;
  selectedWorkspaceId: string;
  selectedModeId?: string;
  text: string;
  blocks: PromptInputBlock[];
  optimisticContentParts: ContentPart[];
  previousActiveSessionId: string | null;
  createEmptySessionWithResolvedConfig: (options: {
    agentKind: string;
    modelId: string;
    modeId?: string;
    workspaceId: string;
  }) => Promise<string>;
  applyPrePromptConfigChanges: (sessionId: string) => Promise<void>;
  promptSession: (options: {
    sessionId: string;
    text: string;
    blocks: PromptInputBlock[];
    optimisticContentParts: ContentPart[];
    workspaceId: string;
  }) => Promise<void>;
  dismissSession: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string) => Promise<SessionActivationOutcome | void>;
  hasSession: (sessionId: string) => boolean;
  onCompleted: () => void;
  showToast: (message: string) => void;
}

export async function executePlanHandoff({
  launchSelection,
  selectedWorkspaceId,
  selectedModeId,
  text,
  blocks,
  optimisticContentParts,
  previousActiveSessionId,
  createEmptySessionWithResolvedConfig,
  applyPrePromptConfigChanges,
  promptSession,
  dismissSession,
  selectSession,
  hasSession,
  onCompleted,
  showToast,
}: ExecutePlanHandoffInput): Promise<void> {
  let createdSessionId: string | null = null;
  try {
    createdSessionId = await createEmptySessionWithResolvedConfig({
      agentKind: launchSelection.kind,
      modelId: launchSelection.modelId,
      modeId: selectedModeId,
      workspaceId: selectedWorkspaceId,
    });
    await applyPrePromptConfigChanges(createdSessionId);
    await promptSession({
      sessionId: createdSessionId,
      text,
      blocks,
      optimisticContentParts,
      workspaceId: selectedWorkspaceId,
    });
    onCompleted();
  } catch (error) {
    if (isSessionModelAvailabilityInterruption(error)) {
      return;
    }
    if (createdSessionId) {
      await dismissSession(createdSessionId).catch(() => undefined);
      if (previousActiveSessionId && hasSession(previousActiveSessionId)) {
        await selectSession(previousActiveSessionId).catch(() => undefined);
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    showToast(`Failed to hand off plan: ${message}`);
  }
}

async function applyPlanHandoffPrePromptConfigChanges(
  sessionId: string,
  collaborationMode: NormalizedSessionControl | null,
): Promise<void> {
  const changes = resolvePlanHandoffPrePromptConfigChanges(collaborationMode);
  if (changes.length === 0) {
    return;
  }

  const { connection, materializedSessionId } = await getSessionClientAndWorkspace(sessionId);
  const client = getAnyHarnessClient(connection);
  for (const change of changes) {
    const response = await client.sessions.setConfigOption(
      materializedSessionId,
      {
        configId: change.rawConfigId,
        value: change.value,
      },
    );
    if (response.applyState !== "applied") {
      // Queued config changes apply after a turn completes. Handoff must switch
      // out of plan mode before sending the first prompt, so queued is unsafe.
      throw new Error("The session could not leave plan mode before the first prompt.");
    }
  }
}

function currentCollaborationModeForSession(
  sessionId: string,
): NormalizedSessionControl | null {
  return getSessionRecord(sessionId)
    ?.liveConfig
    ?.normalizedControls
    .collaborationMode ?? null;
}
