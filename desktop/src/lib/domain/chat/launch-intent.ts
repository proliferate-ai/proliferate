import type { ContentPart } from "@anyharness/sdk";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
} from "@/lib/domain/home/home-next-launch";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/pending-entry";

export type ChatLaunchTargetKind = HomeLaunchTarget["kind"];

export type ChatLaunchRetryMode =
  | "safe"
  | "manual_after_workspace"
  | "unknown_after_send";

export interface ChatLaunchRetryInput {
  text: string;
  modelSelection: HomeNextModelSelection;
  modeId: string | null;
  target: HomeLaunchTarget;
}

export interface ChatLaunchIntentFailure {
  message: string;
  retryMode: ChatLaunchRetryMode;
  failedAt: number;
}

export interface ChatLaunchIntent {
  id: string;
  promptId: string;
  text: string;
  contentParts: ContentPart[];
  targetKind: ChatLaunchTargetKind;
  retryInput: ChatLaunchRetryInput;
  materializedWorkspaceId: string | null;
  materializedSessionId: string | null;
  createdAt: number;
  sendAttemptedAt: number | null;
  failure: ChatLaunchIntentFailure | null;
}

export interface ChatLaunchIntentViewModel {
  title: string;
  detail: string;
  canRetry: boolean;
  canReturnHome: boolean;
  canDismiss: boolean;
  dismissLabel: string;
}

export function resolveChatLaunchRetryMode(
  intent: ChatLaunchIntent | null,
): ChatLaunchRetryMode {
  if (!intent) {
    return "safe";
  }

  if (intent.sendAttemptedAt !== null) {
    return "unknown_after_send";
  }

  if (intent.materializedSessionId || intent.materializedWorkspaceId) {
    return "manual_after_workspace";
  }

  return "safe";
}

export function resolveLaunchIntentPendingWorkspaceId(
  intent: ChatLaunchIntent,
  pending: PendingWorkspaceEntry | null,
): string | null {
  if (!pending?.workspaceId) {
    return null;
  }

  const target = intent.retryInput.target;
  if (target.kind === "cowork") {
    return pending.source === "cowork-created" ? pending.workspaceId : null;
  }
  if (target.kind === "worktree") {
    return pending.source === "worktree-created" ? pending.workspaceId : null;
  }
  if (target.kind === "cloud") {
    return pending.source === "cloud-created" ? pending.workspaceId : null;
  }
  if (target.kind === "local") {
    return !target.existingWorkspaceId && pending.source === "local-created"
      ? pending.workspaceId
      : null;
  }

  return null;
}

export function resolveChatLaunchIntentView(
  intent: ChatLaunchIntent,
): ChatLaunchIntentViewModel {
  if (intent.failure) {
    if (intent.failure.retryMode === "unknown_after_send") {
      return {
        title: "Check this thread before retrying",
        detail: "The message may have reached the session. Review this thread before sending it again.",
        canRetry: false,
        canReturnHome: false,
        canDismiss: true,
        dismissLabel: "Show thread",
      };
    }

    if (intent.failure.retryMode === "manual_after_workspace") {
      return {
        title: intent.materializedSessionId
          ? "Open the created thread"
          : "Open the created workspace",
        detail: `${intent.failure.message} The workspace was already created, so retrying from Home could duplicate it.`,
        canRetry: false,
        canReturnHome: false,
        canDismiss: true,
        dismissLabel: intent.materializedSessionId ? "Show thread" : "Show workspace",
      };
    }

    return {
      title: "Couldn't start work",
      detail: intent.failure.message,
      canRetry: true,
      canReturnHome: true,
      canDismiss: false,
      dismissLabel: "Show thread",
    };
  }

  return {
    title: resolvePendingLaunchTitle(intent.targetKind),
    detail: "Your message is ready and the workspace is opening.",
    canRetry: false,
    canReturnHome: false,
    canDismiss: false,
    dismissLabel: "Show thread",
  };
}

function resolvePendingLaunchTitle(targetKind: ChatLaunchTargetKind): string {
  switch (targetKind) {
    case "cowork":
      return "Starting cowork thread";
    case "local":
      return "Opening workspace";
    case "worktree":
      return "Creating worktree";
    case "cloud":
      return "Starting cloud workspace";
  }
}
