import type {
  WorkspaceSessionRecoveryReason,
} from "#product/lib/domain/workspaces/selection/session-recovery";

export const WORKSPACE_SESSION_INLINE_RECOVERY_TITLE = "Chat unavailable";

export const WORKSPACE_SESSION_INLINE_RECOVERY_BODY: Record<
  WorkspaceSessionRecoveryReason,
  string
> = {
  "session-list-failed":
    "We couldn't refresh this workspace's chats. Retry to reconnect this selected chat.",
  "session-create-failed":
    "We couldn't start this chat. Retry when the session runtime is available.",
  "session-selection-failed":
    "We couldn't finish opening this chat. Retry to refresh its session.",
  "no-visible-session":
    "This workspace doesn't have a usable runtime chat yet. Retry to start this selected chat.",
  "launch-configuration-unavailable":
    "No agent and model are configured for this chat. Open Agent settings, then Retry.",
};
