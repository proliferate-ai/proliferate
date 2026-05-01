import {
  selectPendingApprovalInteraction,
  selectPendingMcpElicitationInteraction,
  selectPendingUserInputInteraction,
  selectPrimaryPendingInteraction,
  type PendingInteraction,
  type PendingPromptEntry,
  type PromptCapabilities,
  type TranscriptState,
} from "@anyharness/sdk";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { parsePermissionOptionActions, type PermissionOptionAction } from "@/lib/domain/chat/chat-input-helpers";
import { resolveCurrentModeLabel } from "@/lib/domain/chat/chat-input";
import {
  hasVisibleTranscriptContent,
} from "@/lib/domain/chat/pending-prompts";
import { isSessionSlotBusy, resolveSessionViewState, type SessionViewState } from "@/lib/domain/sessions/activity";
import { getPendingSessionConfigChange, type PendingSessionConfigChanges } from "@/lib/domain/sessions/pending-config";
import { useHarnessStore, type SessionStreamConnectionState } from "@/stores/sessions/harness-store";

const EMPTY_PENDING_PROMPTS: readonly PendingPromptEntry[] = [];
const EMPTY_PENDING_INTERACTIONS: readonly PendingInteraction[] = [];

export interface ActiveLaunchIdentity {
  kind: string;
  modelId: string;
}

export function useActiveSessionId(): string | null {
  return useHarnessStore((state) => state.activeSessionId);
}

export function useActiveSessionWorkspaceId(): string | null {
  return useHarnessStore((state) => {
    const activeSessionId = state.activeSessionId;
    return activeSessionId
      ? state.sessionSlots[activeSessionId]?.workspaceId ?? null
      : null;
  });
}

export function useActiveSessionPromptCapabilities(): PromptCapabilities | null {
  return useHarnessStore((state) => {
    const activeSessionId = state.activeSessionId;
    return activeSessionId
      ? state.sessionSlots[activeSessionId]?.liveConfig?.promptCapabilities ?? null
      : null;
  });
}

export function useActiveSessionRunningState(): boolean {
  return useHarnessStore((state) => {
    const activeSessionId = state.activeSessionId;
    return activeSessionId
      ? isSessionSlotBusy(state.sessionSlots[activeSessionId] ?? null)
      : false;
  });
}

export function useActiveSessionTranscript(): TranscriptState | null {
  return useHarnessStore((state) => {
    const activeSessionId = state.activeSessionId;
    return activeSessionId
      ? state.sessionSlots[activeSessionId]?.transcript ?? null
      : null;
  });
}

export function useActiveTranscriptPaneState(): {
  activeSessionId: string | null;
  transcript: TranscriptState | null;
  optimisticPrompt: PendingPromptEntry | null;
  sessionViewState: SessionViewState;
  oldestLoadedEventSeq: number | null;
} {
  return useHarnessStore(useShallow((state) => {
    const activeSessionId = state.activeSessionId;
    const slot = activeSessionId ? state.sessionSlots[activeSessionId] ?? null : null;
    return {
      activeSessionId,
      transcript: slot?.transcript ?? null,
      optimisticPrompt: slot?.optimisticPrompt ?? null,
      sessionViewState: resolveSessionViewState(slot),
      oldestLoadedEventSeq: slot?.events[0]?.seq ?? null,
    };
  }));
}

export function useActiveSessionSurfaceSnapshot(): {
  activeSessionId: string | null;
  hasContent: boolean;
  hasSlot: boolean;
  transcriptHydrated: boolean;
  isEmpty: boolean;
  isRunning: boolean;
  sessionViewState: SessionViewState;
  streamConnectionState: SessionStreamConnectionState | null;
} {
  return useHarnessStore(useShallow((state) => {
    const activeSessionId = state.activeSessionId;
    const slot = activeSessionId ? state.sessionSlots[activeSessionId] ?? null : null;
    const transcript = slot?.transcript ?? null;
    const optimisticPrompt = slot?.optimisticPrompt ?? null;
    const hasContent = transcript
      ? hasVisibleTranscriptContent({ transcript, optimisticPrompt })
      : optimisticPrompt !== null;
    const hasSlot = slot !== null;
    return {
      activeSessionId,
      hasContent,
      hasSlot,
      transcriptHydrated: slot?.transcriptHydrated ?? false,
      isEmpty: activeSessionId !== null && hasSlot && !hasContent,
      isRunning: isSessionSlotBusy(slot),
      sessionViewState: resolveSessionViewState(slot),
      streamConnectionState: slot?.streamConnectionState ?? null,
    };
  }));
}

export function useActivePendingPrompts(): readonly PendingPromptEntry[] {
  return useHarnessStore((state) => {
    const activeSessionId = state.activeSessionId;
    return activeSessionId
      ? state.sessionSlots[activeSessionId]?.transcript.pendingPrompts ?? EMPTY_PENDING_PROMPTS
      : EMPTY_PENDING_PROMPTS;
  });
}

export function useActivePendingInteractionState(): {
  pendingInteractions: readonly PendingInteraction[];
  pendingApproval: ReturnType<typeof selectPendingApprovalInteraction>;
  pendingUserInput: ReturnType<typeof selectPendingUserInputInteraction>;
  pendingMcpElicitation: ReturnType<typeof selectPendingMcpElicitationInteraction>;
  primaryPendingInteraction: ReturnType<typeof selectPrimaryPendingInteraction>;
} {
  return useHarnessStore(useShallow((state) => {
    const activeSessionId = state.activeSessionId;
    const transcript = activeSessionId
      ? state.sessionSlots[activeSessionId]?.transcript ?? null
      : null;
    return {
      pendingInteractions: transcript?.pendingInteractions ?? EMPTY_PENDING_INTERACTIONS,
      pendingApproval: transcript ? selectPendingApprovalInteraction(transcript) : null,
      pendingUserInput: transcript ? selectPendingUserInputInteraction(transcript) : null,
      pendingMcpElicitation: transcript ? selectPendingMcpElicitationInteraction(transcript) : null,
      primaryPendingInteraction: transcript ? selectPrimaryPendingInteraction(transcript) : null,
    };
  }));
}

export function useActivePendingApproval(): {
  pendingApproval: ReturnType<typeof selectPendingApprovalInteraction>;
  pendingApprovalActions: PermissionOptionAction[];
} {
  const pendingApproval = useActivePendingInteractionState().pendingApproval;
  const pendingApprovalActions = useMemo<PermissionOptionAction[]>(
    () => parsePermissionOptionActions(pendingApproval?.options),
    [pendingApproval?.options],
  );
  return { pendingApproval, pendingApprovalActions };
}

export function useActiveSessionLaunchState(): {
  activeSessionId: string | null;
  currentLaunchIdentity: ActiveLaunchIdentity | null;
  currentModelConfigId: string | null;
  pendingConfigChanges: PendingSessionConfigChanges | null;
  modelId: string | null;
  agentKind: string | null;
  modelControl: NonNullable<TranscriptState["liveConfig"]>["normalizedControls"]["model"] | null;
} {
  const slice = useHarnessStore(useShallow((state) => {
    const activeSessionId = state.activeSessionId;
    const slot = activeSessionId ? state.sessionSlots[activeSessionId] ?? null : null;
    const modelControl = slot?.liveConfig?.normalizedControls.model ?? null;
    return {
      activeSessionId,
      agentKind: slot?.agentKind ?? null,
      modelId: slot?.modelId ?? null,
      pendingConfigChanges: slot?.pendingConfigChanges ?? null,
      currentModelConfigId: modelControl?.rawConfigId ?? null,
      modelControl,
    };
  }));

  const pendingModelId = useMemo(() => {
    if (!slice.pendingConfigChanges || !slice.currentModelConfigId) {
      return null;
    }
    return getPendingSessionConfigChange(
      slice.pendingConfigChanges,
      slice.currentModelConfigId,
    )?.value ?? null;
  }, [slice.currentModelConfigId, slice.pendingConfigChanges]);

  const currentLaunchIdentity = useMemo<ActiveLaunchIdentity | null>(() => {
    if (!slice.agentKind) {
      return null;
    }
    const modelId = pendingModelId ?? slice.modelId ?? null;
    return modelId ? { kind: slice.agentKind, modelId } : null;
  }, [pendingModelId, slice.agentKind, slice.modelId]);

  return {
    ...slice,
    currentLaunchIdentity,
  };
}

export function useActiveSessionConfigState() {
  return useHarnessStore(useShallow((state) => {
    const activeSessionId = state.activeSessionId;
    const slot = activeSessionId ? state.sessionSlots[activeSessionId] ?? null : null;
    return {
      agentKind: slot?.agentKind ?? null,
      workspaceId: slot?.workspaceId ?? null,
      normalizedControls: slot?.liveConfig?.normalizedControls ?? null,
      pendingConfigChanges: slot?.pendingConfigChanges ?? null,
    };
  }));
}

export function useActiveSessionModeState(): {
  currentModeId: string | null;
  currentModeLabel: string | null;
} {
  return useHarnessStore(useShallow((state) => {
    const activeSessionId = state.activeSessionId;
    const slot = activeSessionId ? state.sessionSlots[activeSessionId] ?? null : null;
    return {
      currentModeId: slot?.transcript.currentModeId ?? slot?.modeId ?? null,
      currentModeLabel: resolveCurrentModeLabel(slot ?? null),
    };
  }));
}
