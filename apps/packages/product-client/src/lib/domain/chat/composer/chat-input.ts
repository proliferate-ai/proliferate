interface ChatInputAvailabilityArgs {
  selectedWorkspaceId: string | null;
  isCloudWorkspaceSelected: boolean;
  /**
   * Non-null when the selected local workspace's checkout directory is gone
   * from disk; carries the kind-worded copy (see workspace-availability-copy).
   */
  workspaceDirectoryMissingSendReason?: string | null;
  connectionState: string;
  selectedCloudWorkspaceStatus: string | null;
  selectedCloudWorkspaceActionBlockReason: string | null;
  selectedCloudRuntimePhase: "ready" | "resuming" | "failed" | "claim_required" | null;
  selectedCloudRuntimeActionBlockReason: string | null;
  activeSessionId: string | null;
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
  /**
   * Send is blocked but the editor stays editable so drafts aren't lost —
   * used for persistent workspace conditions (missing worktree) rather than
   * transient not-ready states, which disable the whole input.
   */
  sendBlockedReason: string | null;
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
  workspaceDirectoryMissingSendReason = null,
  connectionState,
  selectedCloudWorkspaceStatus,
  selectedCloudWorkspaceActionBlockReason,
  selectedCloudRuntimePhase,
  selectedCloudRuntimeActionBlockReason,
  activeSessionId,
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
        sendBlockedReason: null,
        areRuntimeControlsDisabled: false,
        selectedWorkspaceKind: pendingWorkspaceEntry.source === "cloud-created" ? "cloud" : "local",
      };
    }

    return {
      isDisabled: true,
      disabledReason: "Resolve workspace setup before starting chat.",
      sendBlockedReason: null,
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind: pendingWorkspaceEntry.source === "cloud-created" ? "cloud" : "local",
    };
  }

  if (!selectedWorkspaceId) {
    return {
      isDisabled: true,
      disabledReason: "Select a workspace to start chatting.",
      sendBlockedReason: null,
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind,
    };
  }

  // A missing worktree is a persistent workspace condition: the draft stays
  // editable (nothing is lost) while send is refused with an explicit reason.
  if (!isCloudWorkspaceSelected && workspaceDirectoryMissingSendReason) {
    return {
      isDisabled: false,
      disabledReason: null,
      sendBlockedReason: workspaceDirectoryMissingSendReason,
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
      sendBlockedReason: null,
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind,
    };
  }

  if (isCloudWorkspaceSelected && selectedCloudRuntimePhase && selectedCloudRuntimePhase !== "ready") {
    return {
      isDisabled: true,
      disabledReason: selectedCloudRuntimeActionBlockReason,
      sendBlockedReason: null,
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind,
    };
  }

  if (!isCloudWorkspaceSelected && connectionState !== "healthy") {
    return {
      isDisabled: true,
      disabledReason: "AnyHarness runtime is still starting.",
      sendBlockedReason: null,
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind,
    };
  }

  if (!activeSessionId && isConfiguredLaunchLoading) {
    return {
      isDisabled: true,
      disabledReason: "Starting session…",
      sendBlockedReason: null,
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind,
    };
  }

  if (!activeSessionId && !hasReadyConfiguredLaunch) {
    return {
      isDisabled: true,
      disabledReason: configuredLaunchDisabledReason ?? "Your chosen default agent is not ready yet.",
      sendBlockedReason: null,
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind,
    };
  }

  if (pendingInteractionKind) {
    return {
      isDisabled: true,
      disabledReason: pendingInteractionDisabledReason(pendingInteractionKind),
      sendBlockedReason: null,
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind,
    };
  }

  return {
    isDisabled: false,
    disabledReason: null,
    sendBlockedReason: null,
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
