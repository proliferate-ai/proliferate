import type { SetupScriptExecution } from "@anyharness/sdk";
import type { CreateWorktreeWorkspaceInput } from "@/lib/domain/workspaces/creation/workspace-creation";

export type PendingWorkspaceSource =
  | "local-created"
  | "worktree-created"
  | "cloud-created"
  | "cowork-created";

export type PendingWorkspaceStage =
  | "submitting"
  | "awaiting-cloud-ready"
  | "failed";

export interface PendingCoworkRequestInput {
  agentKind: string;
  modelId: string;
  modeId?: string;
  draftText?: string | null;
  sourceWorkspaceId?: string | null;
}

export interface PendingCloudWorkspaceRequestInput {
  gitProvider: "github";
  gitOwner: string;
  gitRepoName: string;
  baseBranch?: string | null;
  branchName: string;
  displayName?: string | null;
  generatedName: boolean;
  ownerScope: "personal" | "organization";
  organizationId?: string | null;
}

export type PendingWorkspaceRequest =
  | { kind: "local"; sourceRoot: string }
  | { kind: "worktree"; input: CreateWorktreeWorkspaceInput }
  | { kind: "cloud"; input: PendingCloudWorkspaceRequestInput }
  | { kind: "cowork"; input: PendingCoworkRequestInput }
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

export type PendingWorkspaceInitialSession =
  | { kind: "none" }
  | {
    kind: "session";
    agentKind: string;
    modelId: string;
    modeId?: string | null;
    launchControlValues?: Record<string, string>;
    displayTitle?: string | null;
  };

export function createPendingWorkspaceAttemptId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildPendingWorkspaceUiKey(entry: Pick<PendingWorkspaceEntry, "attemptId">): string {
  return `pending-workspace:${entry.attemptId}`;
}

export function resolvePendingWorkspacePath(
  entry: PendingWorkspaceEntry | null | undefined,
): string | null {
  if (!entry) {
    return null;
  }

  switch (entry.request.kind) {
    case "local":
      return entry.request.sourceRoot.trim() || null;
    case "worktree":
      return entry.request.input.targetPath?.trim() || null;
    case "cloud":
    case "cowork":
    case "select-existing":
      return null;
  }
}

export function isPendingWorkspaceUiKey(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("pending-workspace:");
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
