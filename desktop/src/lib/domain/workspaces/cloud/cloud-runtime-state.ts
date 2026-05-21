import type {
  CloudRuntimeAuthState,
  CloudWorkspaceStatus,
  CloudWorkspaceVisibility,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-model";

export type SelectedCloudRuntimePhase = "ready" | "resuming" | "failed" | "claim_required";
export type SelectedCloudRuntimeVariant = "initial" | "warm";
export type SelectedCloudRuntimeTone = "pending" | "error";
export type SelectedCloudRuntimeConnectionState = "resolving" | "ready" | "failed";

export interface SelectedCloudRuntimeViewModel {
  phase: SelectedCloudRuntimePhase;
  variant: SelectedCloudRuntimeVariant;
  tone: SelectedCloudRuntimeTone;
  title: string | null;
  subtitle: string | null;
  actionBlockReason: string | null;
  preserveVisibleContent: boolean;
  showRetry: boolean;
  showClaim: boolean;
}

export function buildSelectedCloudRuntimeViewModel(args: {
  persistedStatus: CloudWorkspaceStatus | null;
  visibility?: CloudWorkspaceVisibility | null;
  connectionState: SelectedCloudRuntimeConnectionState;
  runtimeAuth?: CloudRuntimeAuthState | null;
  isWarm: boolean;
}): SelectedCloudRuntimeViewModel | null {
  if (args.persistedStatus !== "ready") {
    return null;
  }

  const variant: SelectedCloudRuntimeVariant = args.isWarm ? "warm" : "initial";
  const runtimeAuth = args.runtimeAuth ?? null;

  if (args.visibility === "shared_unclaimed") {
    return {
      phase: "claim_required",
      variant,
      tone: "pending",
      title: "Shared workspace unclaimed",
      subtitle: "Claim this workspace to open it directly in Desktop.",
      actionBlockReason: "This is shared team work. Claim it to attach Desktop directly to the runtime.",
      preserveVisibleContent: variant === "warm",
      showRetry: false,
      showClaim: true,
    };
  }

  if (runtimeAuth?.status === "apply_failed") {
    return {
      phase: "failed",
      variant,
      tone: "error",
      title: "Agent authentication failed",
      subtitle: runtimeAuth.lastError ?? "Retry agent authentication.",
      actionBlockReason: runtimeAuth.lastError ?? "Agent authentication failed to apply. Retry.",
      preserveVisibleContent: variant === "warm",
      showRetry: true,
      showClaim: false,
    };
  }

  if (runtimeAuth?.status === "restart_required") {
    return {
      phase: "failed",
      variant,
      tone: "error",
      title: "Credential restart required",
      subtitle: "Close active cloud sessions, then retry to apply updated credentials.",
      actionBlockReason: "Agent authentication changed. Close active cloud sessions, then retry to apply it.",
      preserveVisibleContent: variant === "warm",
      showRetry: true,
      showClaim: false,
    };
  }

  if (runtimeAuth?.status === "missing_credentials") {
    return {
      phase: "failed",
      variant,
      tone: "error",
      title: "Agent authentication required",
      subtitle: "Sync an agent credential before starting cloud sessions.",
      actionBlockReason: "Sync an agent credential before starting cloud sessions.",
      preserveVisibleContent: variant === "warm",
      showRetry: false,
      showClaim: false,
    };
  }

  if (args.connectionState === "ready") {
    return {
      phase: "ready",
      variant,
      tone: "pending",
      title: null,
      subtitle: null,
      actionBlockReason: null,
      preserveVisibleContent: false,
      showRetry: false,
      showClaim: false,
    };
  }

  if (args.connectionState === "failed") {
    return {
      phase: "failed",
      variant,
      tone: "error",
      title: "Couldn't reconnect cloud workspace",
      subtitle: "Retry to restore chat, files, and terminals.",
      actionBlockReason: "Cloud workspace couldn't reconnect. Retry to restore chat, files, and terminals.",
      preserveVisibleContent: variant === "warm",
      showRetry: true,
      showClaim: false,
    };
  }

  return {
    phase: "resuming",
    variant,
    tone: "pending",
    title: variant === "warm" ? "Reconnecting..." : "Resuming cloud workspace...",
    subtitle: variant === "warm"
      ? "This workspace is paused while the cloud runtime reconnects."
      : "Waking the runtime and reconnecting chat, files, and terminals.",
    actionBlockReason: variant === "warm"
      ? "Cloud workspace is reconnecting. Runtime-backed actions are paused until it comes back."
      : "Cloud workspace is resuming. Runtime-backed actions are paused until it comes back.",
    preserveVisibleContent: variant === "warm",
    showRetry: false,
    showClaim: false,
  };
}
