import type {
  WorkspaceSessionRecoveryReason,
} from "#product/lib/domain/workspaces/selection/session-recovery";

export const WORKSPACE_SESSION_RECOVERY_TITLE = "We couldn't open a session";

export const WORKSPACE_SESSION_RECOVERY_BODY: Record<WorkspaceSessionRecoveryReason, string> = {
  "session-list-failed":
    "The session list could not be loaded after a retry. Try again, reload the app, or return to workspaces.",
  "session-create-failed":
    "This workspace has no usable session, and a new one could not be prepared. Try again, reload the app, or return to workspaces.",
  "session-selection-failed":
    "A session was found, but it could not be selected. Try again, reload the app, or return to workspaces.",
  "no-visible-session":
    "This workspace does not currently have a visible session to open. Try again, reload the app, or return to workspaces.",
};
