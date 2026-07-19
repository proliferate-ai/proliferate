export type WorkspaceSessionRecoveryReason =
  | "session-list-failed"
  | "session-create-failed"
  | "session-selection-failed"
  | "no-visible-session";

export interface WorkspaceSessionRecovery {
  workspaceId: string;
  logicalWorkspaceId: string;
  reason: WorkspaceSessionRecoveryReason;
}
