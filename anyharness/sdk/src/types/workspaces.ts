/**
 * Workspace contract types.
 */

export type WorkspaceKind = "repo" | "worktree" | "local";

export type WorkspaceExecutionPhase =
  | "running"
  | "awaiting_permission"
  | "idle"
  | "errored";

export interface WorkspaceExecutionSummary {
  phase: WorkspaceExecutionPhase;
  totalSessionCount: number;
  liveSessionCount: number;
  runningCount: number;
  awaitingPermissionCount: number;
  idleCount: number;
  erroredCount: number;
}

export interface Workspace {
  id: string;
  kind: WorkspaceKind;
  path: string;
  sourceRepoRootPath: string;
  sourceWorkspaceId?: string | null;
  gitProvider?: string | null;
  gitOwner?: string | null;
  gitRepoName?: string | null;
  originalBranch?: string | null;
  currentBranch?: string | null;
  displayName?: string | null;
  executionSummary?: WorkspaceExecutionSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateWorkspaceDisplayNameRequest {
  /**
   * New display name. `null` or an empty string clears the override and
   * restores the default branch- or repo-derived label.
   */
  displayName?: string | null;
}

export interface WorkspaceSessionLaunchModel {
  id: string;
  displayName: string;
  isDefault: boolean;
}

export interface WorkspaceSessionLaunchAgent {
  kind: string;
  displayName: string;
  defaultModelId?: string | null;
  models: WorkspaceSessionLaunchModel[];
}

export interface WorkspaceSessionLaunchCatalog {
  workspaceId: string;
  agents: WorkspaceSessionLaunchAgent[];
}

export interface ResolveWorkspaceFromPathRequest {
  path: string;
}

export interface CreateWorkspaceRequest {
  path: string;
}

export interface RegisterRepoWorkspaceRequest {
  path: string;
}

export interface CreateWorktreeWorkspaceRequest {
  sourceWorkspaceId: string;
  targetPath: string;
  newBranchName: string;
  baseBranch?: string;
  setupScript?: string;
}

export type SetupScriptStatus = "queued" | "running" | "succeeded" | "failed";

export interface SetupScriptExecution {
  command: string;
  status: SetupScriptStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CreateWorktreeWorkspaceResponse {
  workspace: Workspace;
  setupScript?: SetupScriptExecution | null;
}

export type SetupHintCategory = "build_tool" | "secret_sync";

export interface SetupHint {
  id: string;
  label: string;
  suggestedCommand: string;
  detectedFile: string;
  category: SetupHintCategory;
}

export interface DetectProjectSetupResponse {
  hints: SetupHint[];
}

export interface GetSetupStatusResponse {
  status: SetupScriptStatus;
  command: string;
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  durationMs?: number | null;
}

export interface StartWorkspaceSetupRequest {
  command: string;
  baseRef?: string | null;
}
