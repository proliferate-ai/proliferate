export type WorkspaceSessionRecoveryReason =
  | "session-list-failed"
  | "session-create-failed"
  | "session-selection-failed"
  | "no-visible-session"
  | "launch-configuration-unavailable";

export interface WorkspaceSessionRecovery {
  workspaceId: string;
  logicalWorkspaceId: string;
  sessionId: string;
  reason: WorkspaceSessionRecoveryReason;
}

export function resolveWorkspaceSessionRecoverySendBlockedReason(
  reason: WorkspaceSessionRecoveryReason,
): string {
  return reason === "launch-configuration-unavailable"
    ? "Configure an agent before sending."
    : "Retry this chat before sending.";
}
