import type { SetupScriptExecution, Workspace, WorkspaceKind } from "@anyharness/sdk";
import { WORKSPACE_ARRIVAL_LABELS } from "@/copy/workspaces/workspace-arrival-copy";
import { workspaceCurrentBranchName } from "@/lib/domain/workspaces/creation/branch-naming";
import { workspaceBranchLabel, workspaceDisplayName } from "@/lib/domain/workspaces/display/workspace-display";
import {
  buildPendingWorkspaceUiKey,
  resolvePendingWorkspacePath,
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";

export interface WorkspaceArrivalEvent {
  workspaceId: string;
  source: "local-created" | "worktree-created" | "cloud-created" | "cowork-created";
  setupScript?: SetupScriptExecution | null;
  baseBranchName?: string | null;
  createdAt: number;
}

interface WorkspaceArrivalBaseViewModel {
  workspaceId: string;
  source: WorkspaceArrivalEvent["source"];
  kind: "workspace" | "worktree";
  workspacePath: string;
  workspaceKind: WorkspaceKind;
  workspaceName: string;
  repoName: string;
  badgeLabel: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  setupTitle: string;
  setupSummary: string;
  setupCommand: string | null;
  setupActionLabel: string;
  setupStatusLabel: string;
  setupTone: "default" | "success" | "destructive";
  setupDetail: string | null;
  setupTerminalId: string | null;
}

export interface WorktreeArrivalViewModel extends WorkspaceArrivalBaseViewModel {
  kind: "worktree";
  branchName: string;
  baseBranchName: string | null;
}

export interface WorkspaceCreatedArrivalViewModel extends WorkspaceArrivalBaseViewModel {
  kind: "workspace";
}

export type WorkspaceArrivalViewModel =
  | WorktreeArrivalViewModel
  | WorkspaceCreatedArrivalViewModel;

export function summarizeSetupFailure(setup: SetupScriptExecution): string {
  const output = `${setup.stderr}\n${setup.stdout}`.trim();
  const firstLine = output.split("\n").find((line) => line.trim().length > 0);
  if (!firstLine) {
    return `Setup failed with exit code ${setup.exitCode}.`;
  }

  return `Setup failed with exit code ${setup.exitCode}: ${firstLine}`;
}

export function buildWorkspaceArrivalEvent(input: {
  workspaceId: string;
  source: WorkspaceArrivalEvent["source"];
  setupScript?: SetupScriptExecution | null;
  baseBranchName?: string | null;
}): WorkspaceArrivalEvent {
  return {
    workspaceId: input.workspaceId,
    source: input.source,
    setupScript: input.setupScript ?? null,
    baseBranchName: input.baseBranchName ?? null,
    createdAt: Date.now(),
  };
}

// TOOD lol this is a mess
export function buildWorkspaceArrivalViewModel(args: {
  event: WorkspaceArrivalEvent;
  workspace: Workspace;
  configuredSetupScript: string;
  setupTerminalId?: string | null;
}): WorkspaceArrivalViewModel {
  const { event, workspace } = args;
  const workspaceName = workspace.kind === "worktree"
    ? worktreeArrivalName(workspace)
    : workspace.path.split("/").pop()
      ?? workspace.gitRepoName
      ?? "workspace";
  const repoName = workspace.gitRepoName
    ?? workspace.sourceRepoRootPath?.split("/").pop()
    ?? workspaceName;
  const isWorktree = workspace.kind === "worktree";

  const setupScriptCommand = (event.setupScript?.command ?? args.configuredSetupScript).trim();
  const hasSetupScript = setupScriptCommand.length > 0;
  const setupStatus = event.setupScript?.status ?? null;
  const setupTerminalId = args.setupTerminalId ?? null;
  const setupActionLabel = setupStatus === "failed"
    ? "Details"
    : setupTerminalId
      ? WORKSPACE_ARRIVAL_LABELS.seeTerminal
      : hasSetupScript
        ? WORKSPACE_ARRIVAL_LABELS.repositorySettings
        : WORKSPACE_ARRIVAL_LABELS.addSetup;

  const baseViewModel: WorkspaceArrivalBaseViewModel = {
    workspaceId: workspace.id,
    source: event.source,
    kind: isWorktree ? "worktree" : "workspace",
    workspacePath: workspace.path,
    workspaceKind: workspace.kind,
    workspaceName,
    repoName,
    badgeLabel: resolveWorkspaceArrivalBadge(event.source, isWorktree),
    eyebrow: resolveWorkspaceArrivalEyebrow(event.source, isWorktree),
    title: workspaceName,
    subtitle: resolveWorkspaceArrivalSubtitle(
      event.source,
      repoName,
      isWorktree,
      event.baseBranchName?.trim() || null,
    ),
    setupTitle: WORKSPACE_ARRIVAL_LABELS.setupTitle,
    setupSummary: !hasSetupScript
      ? WORKSPACE_ARRIVAL_LABELS.setupMissing
      : setupStatus === "running"
        ? WORKSPACE_ARRIVAL_LABELS.setupRunning
        : setupStatus === "queued"
          ? WORKSPACE_ARRIVAL_LABELS.setupQueued
          : setupStatus === "succeeded"
            ? WORKSPACE_ARRIVAL_LABELS.setupSucceeded
            : setupStatus === "failed"
              ? summarizeSetupFailure(event.setupScript!)
              : WORKSPACE_ARRIVAL_LABELS.setupConfigured,
    setupCommand: hasSetupScript ? setupScriptCommand : null,
    setupActionLabel,
    setupStatusLabel: setupStatus === "running"
      ? WORKSPACE_ARRIVAL_LABELS.setupStatusRunning
      : setupStatus === "queued"
        ? WORKSPACE_ARRIVAL_LABELS.setupStatusQueued
        : setupStatus === "failed"
          ? WORKSPACE_ARRIVAL_LABELS.setupFailed
          : setupStatus === "succeeded"
            ? WORKSPACE_ARRIVAL_LABELS.setupStatusReady
            : hasSetupScript
              ? WORKSPACE_ARRIVAL_LABELS.setupStatusConfigured
              : WORKSPACE_ARRIVAL_LABELS.setupStatusOptional,
    setupTone: setupStatus === "failed"
      ? "destructive"
      : setupStatus === "succeeded"
        ? "success"
        : (setupStatus === "running" || setupStatus === "queued")
          ? "default"
          : "default",
    setupDetail: setupStatus === "failed" && event.setupScript
      ? `${event.setupScript.stderr}\n${event.setupScript.stdout}`.trim() || null
      : null,
    setupTerminalId,
  };

  if (isWorktree) {
    return {
      ...baseViewModel,
      kind: "worktree",
      branchName: worktreeArrivalBranchName(workspace),
      baseBranchName: event.baseBranchName?.trim() || null,
    };
  }

  return {
    ...baseViewModel,
    kind: "workspace",
  };
}

function worktreeArrivalName(workspace: Workspace): string {
  return workspace.path.split("/").filter(Boolean).pop()
    || workspace.displayName?.trim()
    || workspaceCurrentBranchName(workspace)
    || workspaceDisplayName(workspace);
}

function worktreeArrivalBranchName(workspace: Workspace): string {
  return workspaceCurrentBranchName(workspace)
    || workspaceBranchLabel(workspace);
}

function resolveWorkspaceArrivalSubtitle(
  source: WorkspaceArrivalEvent["source"],
  repoName: string,
  isWorktree: boolean,
  baseBranchName: string | null,
): string {
  if (isWorktree) {
    const base = `${WORKSPACE_ARRIVAL_LABELS.worktreeCreatedSubtitlePrefix} ${repoName}`;
    return baseBranchName
      ? `${base} ${WORKSPACE_ARRIVAL_LABELS.worktreeCreatedSubtitleFromInfix} ${baseBranchName}`
      : base;
  }

  return source === "cloud-created"
    ? WORKSPACE_ARRIVAL_LABELS.createdCloudWorkspaceSubtitle
    : WORKSPACE_ARRIVAL_LABELS.createdWorkspaceSubtitle;
}

function resolveWorkspaceArrivalBadge(
  source: WorkspaceArrivalEvent["source"],
  isWorktree: boolean,
): string {
  if (source === "cowork-created") {
    return WORKSPACE_ARRIVAL_LABELS.workspaceBadge;
  }

  if (isWorktree) {
    return WORKSPACE_ARRIVAL_LABELS.newWorktreeBadge;
  }

  if (source === "cloud-created") {
    return WORKSPACE_ARRIVAL_LABELS.newCloudWorkspaceBadge;
  }

  return source === "local-created"
    ? WORKSPACE_ARRIVAL_LABELS.newWorkspaceBadge
    : WORKSPACE_ARRIVAL_LABELS.workspaceBadge;
}

function resolveWorkspaceArrivalEyebrow(
  source: WorkspaceArrivalEvent["source"],
  isWorktree: boolean,
): string {
  if (isWorktree) {
    return WORKSPACE_ARRIVAL_LABELS.worktreeCreatedEyebrow;
  }

  if (source === "cloud-created") {
    return WORKSPACE_ARRIVAL_LABELS.cloudWorkspaceCreatedEyebrow;
  }

  return WORKSPACE_ARRIVAL_LABELS.workspaceCreatedEyebrow;
}

export function buildPendingWorkspaceArrivalViewModel(args: {
  entry: PendingWorkspaceEntry;
  configuredSetupScript?: string | null;
}): WorkspaceArrivalViewModel | null {
  const { entry } = args;
  if (entry.stage === "failed") {
    return null;
  }
  if (entry.source !== "local-created" && entry.source !== "worktree-created") {
    return null;
  }

  const pendingWorkspaceId = buildPendingWorkspaceUiKey(entry);
  const workspacePath = resolvePendingWorkspacePath(entry) ?? entry.displayName;
  const now = new Date(entry.createdAt).toISOString();
  const repoName =
    entry.repoLabel?.trim()
    || workspacePath.split("/").filter(Boolean).pop()
    || entry.displayName
    || "workspace";
  const { request } = entry;
  const isWorktree = request.kind === "worktree";
  const branchName = isWorktree
    ? request.input.branchName?.trim()
      || entry.displayName
    : entry.baseBranchName?.trim()
      || "HEAD";
  const sourceRepoRootPath = request.kind === "local"
    ? request.sourceRoot
    : undefined;
  const workspace: Workspace = {
    id: pendingWorkspaceId,
    kind: isWorktree ? "worktree" : "repo",
    repoRootId: isWorktree ? request.input.repoRootId : undefined,
    path: workspacePath,
    sourceRepoRootPath,
    sourceWorkspaceId: isWorktree ? request.input.sourceWorkspaceId ?? null : null,
    gitProvider: null,
    gitOwner: null,
    gitRepoName: repoName,
    currentBranch: branchName,
    originalBranch: entry.baseBranchName,
    displayName: entry.displayName,
    surface: "standard",
    lifecycleState: "active",
    cleanupState: "none",
    createdAt: now,
    updatedAt: now,
  } as Workspace;

  return buildWorkspaceArrivalViewModel({
    event: buildWorkspaceArrivalEvent({
      workspaceId: pendingWorkspaceId,
      source: entry.source,
      setupScript: entry.setupScript,
      baseBranchName: entry.baseBranchName,
    }),
    workspace,
    configuredSetupScript: args.configuredSetupScript ?? "",
  });
}
