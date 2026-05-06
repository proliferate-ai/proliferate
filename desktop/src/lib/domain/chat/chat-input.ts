interface ChatInputAvailabilityArgs {
  selectedWorkspaceId: string | null;
  isCloudWorkspaceSelected: boolean;
  connectionState: string;
  selectedCloudWorkspaceStatus: string | null;
  selectedCloudWorkspaceActionBlockReason: string | null;
  selectedCloudRuntimePhase: "ready" | "resuming" | "failed" | null;
  selectedCloudRuntimeActionBlockReason: string | null;
  activeSessionId: string | null;
  activeSessionHydrated: boolean;
  isConfiguredLaunchLoading: boolean;
  hasReadyConfiguredLaunch: boolean;
  configuredLaunchDisabledReason: string | null;
}

interface ModeValueLike {
  value: string;
  label: string;
}

interface NormalizedModeControlLike {
  currentValue?: string | null;
  values: ModeValueLike[];
}

interface ChatInputActiveSlotLike {
  modeId?: string | null;
  transcript?: {
    currentModeId?: string | null;
  } | null;
  liveConfig?: {
    normalizedControls?: {
      mode?: NormalizedModeControlLike | null;
    } | null;
  } | null;
}

export interface ChatInputAvailability {
  isDisabled: boolean;
  disabledReason: string | null;
  areRuntimeControlsDisabled: boolean;
  areLaunchControlsDisabled: boolean;
  areUtilityActionsDisabled: boolean;
  areLiveSessionControlsDisabled: boolean;
}

export function resolveChatDraftWorkspaceId(
  selectedLogicalWorkspaceId: string | null,
  selectedWorkspaceId: string | null,
  pendingWorkspaceAttemptId?: string | null,
): string | null {
  return (pendingWorkspaceAttemptId ? pendingWorkspaceDraftKey(pendingWorkspaceAttemptId) : null)
    ?? selectedLogicalWorkspaceId
    ?? selectedWorkspaceId
    ?? null;
}

export function pendingWorkspaceDraftKey(attemptId: string): string {
  return `pending-workspace:${attemptId}`;
}

export function resolveChatInputAvailability({
  selectedWorkspaceId,
  isCloudWorkspaceSelected,
  connectionState,
  selectedCloudWorkspaceStatus,
  selectedCloudWorkspaceActionBlockReason,
  selectedCloudRuntimePhase,
  selectedCloudRuntimeActionBlockReason,
  activeSessionId,
  activeSessionHydrated,
  isConfiguredLaunchLoading,
  hasReadyConfiguredLaunch,
  configuredLaunchDisabledReason,
}: ChatInputAvailabilityArgs): ChatInputAvailability {
  if (!selectedWorkspaceId) {
    return {
      isDisabled: true,
      disabledReason: "Select a workspace to start chatting.",
      areRuntimeControlsDisabled: true,
      areLaunchControlsDisabled: true,
      areUtilityActionsDisabled: true,
      areLiveSessionControlsDisabled: true,
    };
  }

  if (isCloudWorkspaceSelected && selectedCloudWorkspaceStatus !== "ready") {
    return {
      isDisabled: true,
      disabledReason: selectedCloudWorkspaceActionBlockReason
        ?? (
          selectedCloudWorkspaceStatus === "archived"
            ? "Cloud workspace is archived."
            : selectedCloudWorkspaceStatus === "error"
              ? "Cloud workspace hit an error. Retry provisioning to continue."
              : "Cloud workspace is still preparing."
        ),
      areRuntimeControlsDisabled: true,
      areLaunchControlsDisabled: true,
      areUtilityActionsDisabled: true,
      areLiveSessionControlsDisabled: true,
    };
  }

  if (isCloudWorkspaceSelected && selectedCloudRuntimePhase && selectedCloudRuntimePhase !== "ready") {
    return {
      isDisabled: true,
      disabledReason: selectedCloudRuntimeActionBlockReason,
      areRuntimeControlsDisabled: true,
      areLaunchControlsDisabled: true,
      areUtilityActionsDisabled: true,
      areLiveSessionControlsDisabled: true,
    };
  }

  if (!isCloudWorkspaceSelected && connectionState !== "healthy") {
    return {
      isDisabled: true,
      disabledReason: "AnyHarness runtime is still starting.",
      areRuntimeControlsDisabled: true,
      areLaunchControlsDisabled: true,
      areUtilityActionsDisabled: true,
      areLiveSessionControlsDisabled: true,
    };
  }

  if (activeSessionId && !activeSessionHydrated) {
    return {
      isDisabled: true,
      disabledReason: "Session is still loading. Try again in a moment.",
      areRuntimeControlsDisabled: false,
      areLaunchControlsDisabled: false,
      areUtilityActionsDisabled: true,
      areLiveSessionControlsDisabled: true,
    };
  }

  if (!activeSessionId && isConfiguredLaunchLoading) {
    return {
      isDisabled: true,
      disabledReason: "Starting session…",
      areRuntimeControlsDisabled: false,
      areLaunchControlsDisabled: false,
      areUtilityActionsDisabled: true,
      areLiveSessionControlsDisabled: true,
    };
  }

  if (!activeSessionId && !hasReadyConfiguredLaunch) {
    return {
      isDisabled: true,
      disabledReason: configuredLaunchDisabledReason ?? "Your chosen default agent is not ready yet.",
      areRuntimeControlsDisabled: false,
      areLaunchControlsDisabled: false,
      areUtilityActionsDisabled: true,
      areLiveSessionControlsDisabled: true,
    };
  }

  return {
    isDisabled: false,
    disabledReason: null,
    areRuntimeControlsDisabled: false,
    areLaunchControlsDisabled: false,
    areUtilityActionsDisabled: false,
    areLiveSessionControlsDisabled: false,
  };
}

export function resolveCurrentModeLabel(
  activeSlot: ChatInputActiveSlotLike | null,
): string | null {
  const currentModeId =
    activeSlot?.liveConfig?.normalizedControls?.mode?.currentValue
    ?? activeSlot?.modeId
    ?? activeSlot?.transcript?.currentModeId
    ?? null;
  if (!currentModeId) {
    return null;
  }

  const modeControl = activeSlot?.liveConfig?.normalizedControls?.mode ?? null;
  return modeControl?.values.find((value) => value.value === currentModeId)?.label ?? currentModeId;
}
