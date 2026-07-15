interface ChatInputAvailabilityArgs {
  selectedWorkspaceId: string | null;
  isCloudWorkspaceSelected: boolean;
  connectionState: string;
  selectedCloudWorkspaceStatus: string | null;
  selectedCloudWorkspaceActionBlockReason: string | null;
  selectedCloudRuntimePhase: "ready" | "resuming" | "failed" | "claim_required" | null;
  selectedCloudRuntimeActionBlockReason: string | null;
  activeSessionId: string | null;
  activeSessionLaunchDisabledReason?: string | null;
  isConfiguredLaunchLoading: boolean;
  hasReadyConfiguredLaunch: boolean;
  configuredLaunchDisabledReason: string | null;
  pendingWorkspaceEntry: ChatInputPendingWorkspaceEntry | null;
  pendingInteractionKind?: ChatInputPendingInteractionKind | null;
}

export type ChatSelectedWorkspaceKind = "cloud" | "local";
export type ChatInputPendingInteractionKind = "permission" | "user_input" | "mcp_elicitation";

export interface ChatInputPendingWorkspaceEntry {
  source: "local-created" | "worktree-created" | "cloud-created" | "cowork-created";
  stage: "submitting" | "awaiting-cloud-ready" | "failed";
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
}

export interface ChatInputAvailabilityState extends ChatInputAvailability {
  selectedWorkspaceKind: ChatSelectedWorkspaceKind;
}

export function resolveChatDraftWorkspaceId(
  selectedLogicalWorkspaceId: string | null,
  selectedWorkspaceId: string | null,
): string | null {
  return selectedLogicalWorkspaceId ?? selectedWorkspaceId;
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
  activeSessionLaunchDisabledReason = null,
  isConfiguredLaunchLoading,
  hasReadyConfiguredLaunch,
  configuredLaunchDisabledReason,
  pendingWorkspaceEntry,
  pendingInteractionKind = null,
}: ChatInputAvailabilityArgs): ChatInputAvailabilityState {
  const selectedWorkspaceKind = isCloudWorkspaceSelected ? "cloud" : "local";

  if (pendingWorkspaceEntry) {
    if (pendingWorkspaceEntry.stage !== "failed") {
      return {
        isDisabled: false,
        disabledReason: null,
        areRuntimeControlsDisabled: false,
        selectedWorkspaceKind: pendingWorkspaceEntry.source === "cloud-created" ? "cloud" : "local",
      };
    }

    return {
      isDisabled: true,
      disabledReason: "Resolve workspace setup before starting chat.",
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind: pendingWorkspaceEntry.source === "cloud-created" ? "cloud" : "local",
    };
  }

  if (!selectedWorkspaceId) {
    return {
      isDisabled: true,
      disabledReason: "Select a workspace to start chatting.",
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind,
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
      selectedWorkspaceKind,
    };
  }

  if (isCloudWorkspaceSelected && selectedCloudRuntimePhase && selectedCloudRuntimePhase !== "ready") {
    return {
      isDisabled: true,
      disabledReason: selectedCloudRuntimeActionBlockReason,
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind,
    };
  }

  if (!isCloudWorkspaceSelected && connectionState !== "healthy") {
    return {
      isDisabled: true,
      disabledReason: "AnyHarness runtime is still starting.",
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind,
    };
  }

  if (!activeSessionId && isConfiguredLaunchLoading) {
    return {
      isDisabled: true,
      disabledReason: "Starting session…",
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind,
    };
  }

  if (!activeSessionId && !hasReadyConfiguredLaunch) {
    return {
      isDisabled: true,
      disabledReason: configuredLaunchDisabledReason ?? "Your chosen default agent is not ready yet.",
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind,
    };
  }

  if (activeSessionId && activeSessionLaunchDisabledReason) {
    return {
      isDisabled: true,
      disabledReason: activeSessionLaunchDisabledReason,
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind,
    };
  }

  if (pendingInteractionKind) {
    return {
      isDisabled: true,
      disabledReason: pendingInteractionDisabledReason(pendingInteractionKind),
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind,
    };
  }

  return {
    isDisabled: false,
    disabledReason: null,
    areRuntimeControlsDisabled: false,
    selectedWorkspaceKind,
  };
}

function pendingInteractionDisabledReason(kind: ChatInputPendingInteractionKind): string {
  switch (kind) {
    case "permission":
      return "Resolve the pending approval before sending another message.";
    case "user_input":
      return "Answer the pending request before sending another message.";
    case "mcp_elicitation":
      return "Complete the pending MCP form before sending another message.";
  }
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
