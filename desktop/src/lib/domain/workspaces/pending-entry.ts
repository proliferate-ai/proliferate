import type { SetupScriptExecution } from "@anyharness/sdk";
import type { CloudWorkspaceRepoTarget } from "@/lib/domain/workspaces/cloud-workspace-creation";
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
  | { kind: "cloud"; input: CreateCloudWorkspaceRequest; target: CloudWorkspaceRepoTarget }
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

export function createPendingWorkspaceAttemptId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildPendingWorkspaceOriginTarget(
  selectedWorkspaceId: string | null,
): PendingWorkspaceOriginTarget {
  return selectedWorkspaceId
    ? { kind: "workspace", workspaceId: selectedWorkspaceId }
    : { kind: "home" };
}

export function buildSubmittingPendingWorkspaceEntry(input: {
  attemptId: string;
  selectedWorkspaceId: string | null;
  source: PendingWorkspaceEntry["source"];
  displayName: string;
  repoLabel?: string | null;
  baseBranchName?: string | null;
  request: PendingWorkspaceRequest;
}): PendingWorkspaceEntry {
  return {
    attemptId: input.attemptId,
    source: input.source,
    stage: "submitting",
    displayName: input.displayName,
    repoLabel: input.repoLabel ?? null,
    baseBranchName: input.baseBranchName ?? null,
    workspaceId: null,
    request: input.request,
    originTarget: buildPendingWorkspaceOriginTarget(input.selectedWorkspaceId),
    errorMessage: null,
    setupScript: null,
    createdAt: Date.now(),
  };
}
