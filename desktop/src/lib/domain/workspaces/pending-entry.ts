import type { SetupScriptExecution } from "@anyharness/sdk";
import type { CreateCloudWorkspaceRequest } from "@/lib/integrations/cloud/client";
import type { CreateWorktreeWorkspaceInput } from "@/lib/domain/workspaces/workspace-creation";

export type PendingWorkspaceSource =
  | "local-created"
  | "worktree-created"
  | "cloud-created";

export type PendingWorkspaceStage =
  | "submitting"
  | "awaiting-cloud-ready"
  | "failed";

export type PendingWorkspaceRequest =
  | { kind: "local"; sourceRoot: string }
  | { kind: "worktree"; input: CreateWorktreeWorkspaceInput }
  | { kind: "cloud"; input: CreateCloudWorkspaceRequest }
  | { kind: "select-existing"; workspaceId: string };

export type PendingWorkspaceOriginTarget =
  | { kind: "home" }
  | { kind: "workspace"; workspaceId: string };

export interface PendingWorkspaceEntry {
  attemptId: string;
  source: PendingWorkspaceSource;
  stage: PendingWorkspaceStage;
  displayName: string;
  repoLabel: string | null;
  baseBranchName: string | null;
  workspaceId: string | null;
  request: PendingWorkspaceRequest;
  originTarget: PendingWorkspaceOriginTarget;
  errorMessage: string | null;
  setupScript: SetupScriptExecution | null;
  createdAt: number;
}
