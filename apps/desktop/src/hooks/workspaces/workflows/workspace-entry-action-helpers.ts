import type { SetupScriptExecution, Workspace } from "@anyharness/sdk";
import type {
  PendingWorkspaceEntry,
  PendingWorkspaceInitialSession,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  collectWorktreeBasenamesForRepo,
  generateWorkspaceSlug,
} from "@/lib/domain/workspaces/creation/workspace-slug";
import { workspaceCurrentBranchName } from "@/lib/domain/workspaces/creation/branch-naming";
import type {
  CreateWorktreeWorkspaceInput,
} from "@/lib/domain/workspaces/creation/workspace-creation";
import { resolveModelDisplayName } from "@/lib/domain/chat/models/model-display";

export function resolveDisplayNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "workspace";
}

export function normalizeWorktreeInput(
  input: string | CreateWorktreeWorkspaceInput,
  source: Workspace | null,
  allWorkspaces: readonly Workspace[],
): CreateWorktreeWorkspaceInput {
  const existingBasenames = source
    ? collectWorktreeBasenamesForRepo(allWorkspaces, source)
    : new Set<string>();

  if (typeof input === "string") {
    return {
      repoRootId: input,
      workspaceName: generateWorkspaceSlug(existingBasenames),
      generatedName: true,
    };
  }

  const explicitWorkspaceName = input.workspaceName?.trim();
  return {
    ...input,
    workspaceName: explicitWorkspaceName || generateWorkspaceSlug(existingBasenames),
    generatedName: Boolean(input.generatedName || !explicitWorkspaceName),
  };
}

export function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function buildMaterializedWorktreePendingEntry(input: {
  entry: PendingWorkspaceEntry;
  resolvedInput: CreateWorktreeWorkspaceInput;
  workspace: Workspace;
  fallbackBranchName: string;
  fallbackBaseRef: string;
  setupScript: SetupScriptExecution | null;
}): PendingWorkspaceEntry {
  const workspaceName = resolveDisplayNameFromPath(input.workspace.path);
  const branchName = workspaceCurrentBranchName(input.workspace) || input.fallbackBranchName;
  const baseBranch = input.fallbackBaseRef;

  return {
    ...input.entry,
    displayName: workspaceName,
    workspaceId: input.workspace.id,
    baseBranchName: baseBranch,
    request: {
      kind: "worktree",
      input: {
        ...input.resolvedInput,
        workspaceName,
        branchName,
        baseBranch,
        targetPath: input.workspace.path,
      },
    },
    setupScript: input.setupScript,
  };
}

function displayTitleForPendingSession(agentKind: string, modelId: string): string {
  return resolveModelDisplayName({
    agentKind,
    modelId,
    preferKnownAlias: true,
  }) ?? modelId;
}

export function buildPendingInitialSession(input: {
  agentKind: string | null | undefined;
  modelId: string | null | undefined;
  modeId?: string | null;
  launchControlValues?: Record<string, string>;
  displayTitle?: string | null;
}): PendingWorkspaceInitialSession | null {
  const agentKind = input.agentKind?.trim();
  const modelId = input.modelId?.trim();
  if (!agentKind || !modelId) {
    return null;
  }

  return {
    kind: "session",
    agentKind,
    modelId,
    modeId: input.modeId ?? null,
    launchControlValues: input.launchControlValues,
    displayTitle: input.displayTitle ?? displayTitleForPendingSession(agentKind, modelId),
  };
}
