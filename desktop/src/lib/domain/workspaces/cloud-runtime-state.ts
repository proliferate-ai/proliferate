import type { CloudWorkspaceStatus } from "@/lib/integrations/cloud/client";

export type SelectedCloudRuntimePhase = "ready" | "resuming" | "failed";
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
}

export function buildSelectedCloudRuntimeViewModel(args: {
  persistedStatus: CloudWorkspaceStatus | null;
  connectionState: SelectedCloudRuntimeConnectionState;
  isWarm: boolean;
}): SelectedCloudRuntimeViewModel | null {
  if (args.persistedStatus !== "ready") {
    return null;
  }

  const variant: SelectedCloudRuntimeVariant = args.isWarm ? "warm" : "initial";

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
  };
}
