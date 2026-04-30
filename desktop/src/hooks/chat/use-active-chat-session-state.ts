import {
  createTranscriptState,
  selectPendingApprovalInteraction,
  selectPendingMcpElicitationInteraction,
  selectPendingUserInputInteraction,
  selectPrimaryPendingInteraction,
} from "@anyharness/sdk";
import { useMemo } from "react";
import { parsePermissionOptionActions, type PermissionOptionAction } from "@/lib/domain/chat/chat-input-helpers";
import { hasVisibleTranscriptContent } from "@/lib/domain/chat/pending-prompts";
import { resolveCurrentModeLabel } from "@/lib/domain/chat/chat-input";
import { isSessionSlotBusy, resolveSessionViewState } from "@/lib/domain/sessions/activity";
import { getPendingSessionConfigChange } from "@/lib/domain/sessions/pending-config";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export function useActiveChatSessionState() {
  const activeSessionId = useHarnessStore((state) => state.activeSessionId);
  const activeSlot = useHarnessStore((state) =>
    state.activeSessionId ? state.sessionSlots[state.activeSessionId] ?? null : null,
  );

  const currentLaunchIdentity = useMemo(() => {
    if (!activeSlot?.agentKind) {
      return null;
    }
    const pendingModelId = getPendingSessionConfigChange(
      activeSlot.pendingConfigChanges,
      activeSlot.liveConfig?.normalizedControls.model?.rawConfigId ?? null,
    )?.value ?? null;
    const modelId = pendingModelId ?? activeSlot.modelId ?? null;
    if (!modelId) {
      return null;
    }
    return {
      kind: activeSlot.agentKind,
      modelId,
    };
  }, [
    activeSlot?.agentKind,
    activeSlot?.modelId,
    activeSlot?.liveConfig?.normalizedControls.model?.rawConfigId,
    activeSlot?.pendingConfigChanges,
  ]);

  const pendingApproval = activeSlot?.transcript
    ? selectPendingApprovalInteraction(activeSlot.transcript)
    : null;
  const pendingUserInput = activeSlot?.transcript
    ? selectPendingUserInputInteraction(activeSlot.transcript)
    : null;
  const pendingMcpElicitation = activeSlot?.transcript
    ? selectPendingMcpElicitationInteraction(activeSlot.transcript)
    : null;
  const primaryPendingInteraction = activeSlot?.transcript
    ? selectPrimaryPendingInteraction(activeSlot.transcript)
    : null;
  const currentModeId =
    activeSlot?.transcript?.currentModeId
    ?? activeSlot?.modeId
    ?? null;
  const currentModelConfigId =
    activeSlot?.liveConfig?.normalizedControls.model?.rawConfigId
    ?? null;
  const pendingApprovalActions = useMemo<PermissionOptionAction[]>(
    () => parsePermissionOptionActions(pendingApproval?.options),
    [pendingApproval?.options],
  );
  const transcript = activeSlot?.transcript ?? createTranscriptState(activeSessionId ?? "");
  const pendingPrompts = transcript.pendingPrompts;
  const optimisticPrompt = activeSlot?.optimisticPrompt ?? null;
  const totalItems = useMemo(() => transcript.turnOrder.reduce(
    (sum, turnId) => sum + (transcript.turnsById[turnId]?.itemOrder.length ?? 0),
    0,
  ), [transcript]);
  const hasContent = hasVisibleTranscriptContent({
    transcript,
    optimisticPrompt,
  });
  const sessionViewState = resolveSessionViewState(activeSlot);
  const isRunning = isSessionSlotBusy(activeSlot);

  return {
    activeSessionId,
    activeSlot,
    liveConfig: activeSlot?.liveConfig ?? null,
    transcript,
    pendingPrompts,
    optimisticPrompt,
    currentLaunchIdentity,
    currentModelConfigId,
    currentModeId,
    currentModeLabel: resolveCurrentModeLabel(activeSlot ?? null),
    pendingApproval,
    pendingUserInput,
    pendingMcpElicitation,
    primaryPendingInteraction,
    pendingApprovalActions,
    hasPendingApproval: pendingApproval !== null,
    hasPendingUserInput: pendingUserInput !== null,
    hasPendingMcpElicitation: pendingMcpElicitation !== null,
    totalItems,
    hasContent,
    hasSlot: activeSlot !== null,
    transcriptHydrated: activeSlot?.transcriptHydrated ?? false,
    isEmpty: activeSessionId !== null && activeSlot !== null && !hasContent,
    sessionViewState,
    isRunning,
  };
}
