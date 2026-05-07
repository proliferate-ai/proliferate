import type { WorkspaceMobilityPreflightResponse } from "@anyharness/sdk";
import type { CloudWorkspaceMobilityPreflightResponse } from "@/lib/access/cloud/client";

export type WorkspaceMobilityDirection = "local_to_cloud" | "cloud_to_local";

export interface WorkspaceMobilityConfirmSnapshot {
  logicalWorkspaceId: string;
  direction: WorkspaceMobilityDirection;
  sourceWorkspaceId: string;
  mobilityWorkspaceId: string;
  sourcePreflight: WorkspaceMobilityPreflightResponse;
  cloudPreflight: CloudWorkspaceMobilityPreflightResponse;
}

export type WorkspaceMobilityLocationKind =
  | "local_workspace"
  | "local_worktree"
  | "cloud_workspace";

export type WorkspaceMobilityBlockerCode =
  | "repo_required"
  | "local_repo_required"
  | "branch_not_published"
  | "head_commit_not_published"
  | "branch_out_of_sync"
  | "workspace_not_mutable"
  | "default_branch_unknown"
  | "setup_running"
  | "workspace_dirty"
  | "workspace_status_unknown"
  | "local_default_branch_in_use"
  | "session_running"
  | "session_awaiting_interaction"
  | "pending_prompt"
  | "archive_too_large"
  | "missing_branch_name"
  | "missing_base_commit_sha"
  | "workspace_handoff_in_progress"
  | "user_handoff_in_progress"
  | "branch_mismatch"
  | "owner_mismatch"
  | "github_account_required"
  | "cloud_lost"
  | "cloud_repo_access"
  | "cleanup_failed"
  | "handoff_failed"
  | "unknown";
