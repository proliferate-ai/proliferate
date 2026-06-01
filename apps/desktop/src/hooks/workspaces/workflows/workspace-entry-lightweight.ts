import type { RepoRoot, SetupScriptExecution, Workspace } from "@anyharness/sdk";
import type {
  CreateWorktreeWorkspaceInput,
  ResolvedWorktreeCreation,
  WorktreeCreationParams,
} from "@/lib/domain/workspaces/creation/workspace-creation";
import { sidebarRepoGroupKeyForWorkspace } from "@/lib/domain/workspaces/sidebar/sidebar-group-key";
import {
  annotateLatencyFlow,
  failLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import type { WorkspaceEntryResult } from "@/hooks/workspaces/workflows/workspace-entry-types";

export async function runLightweightLocalWorkspaceEntry(
  input: {
    repoRoots: RepoRoot[];
    sourceRoot: string;
  },
  deps: {
    createLocalWorkspace: (sourceRoot: string) => Promise<Workspace>;
    requestChatInputFocus: () => void;
    selectWorkspaceWithArrival: (options: {
      workspaceId: string;
      source: "local-created";
      setupScript: null;
      baseBranchName: null;
      repoGroupKeyToExpand: string | null;
    }) => Promise<void>;
  },
): Promise<WorkspaceEntryResult> {
  deps.requestChatInputFocus();
  const workspace = await deps.createLocalWorkspace(input.sourceRoot);
  await deps.selectWorkspaceWithArrival({
    workspaceId: workspace.id,
    source: "local-created",
    setupScript: null,
    baseBranchName: null,
    repoGroupKeyToExpand: sidebarRepoGroupKeyForWorkspace(workspace, input.repoRoots),
  });
  return { workspaceId: workspace.id, projectedSessionId: null };
}

export async function runLightweightWorktreeWorkspaceEntry(
  input: {
    latencyFlowId?: string | null;
    normalizedInput: CreateWorktreeWorkspaceInput;
    repoRoots: RepoRoot[];
  },
  deps: {
    createWorktreeWorkspace: (
      params: WorktreeCreationParams,
      options: { latencyFlowId?: string | null },
    ) => Promise<{
      setupScript?: SetupScriptExecution | null;
      workspace: Workspace;
    }>;
    requestChatInputFocus: () => void;
    resolveWorktreeCreationInput: (input: CreateWorktreeWorkspaceInput) => Promise<ResolvedWorktreeCreation>;
    selectWorkspaceWithArrival: (options: {
      workspaceId: string;
      source: "worktree-created";
      setupScript: SetupScriptExecution | null;
      baseBranchName: string | null;
      repoGroupKeyToExpand: string | null;
      latencyFlowId?: string | null;
    }) => Promise<void>;
  },
): Promise<WorkspaceEntryResult> {
  try {
    deps.requestChatInputFocus();
    const resolved = await deps.resolveWorktreeCreationInput(input.normalizedInput);
    const result = await deps.createWorktreeWorkspace(resolved.params, {
      latencyFlowId: input.latencyFlowId,
    });
    const repoGroupKeyToExpand = sidebarRepoGroupKeyForWorkspace(result.workspace, input.repoRoots);
    annotateLatencyFlow(input.latencyFlowId, {
      targetWorkspaceId: result.workspace.id,
    });
    await deps.selectWorkspaceWithArrival({
      workspaceId: result.workspace.id,
      source: "worktree-created",
      setupScript: result.setupScript ?? null,
      baseBranchName: resolved.params.baseRef,
      repoGroupKeyToExpand,
      latencyFlowId: input.latencyFlowId,
    });
    return { workspaceId: result.workspace.id, projectedSessionId: null };
  } catch (error) {
    failLatencyFlow(input.latencyFlowId, "worktree_enter_failed");
    throw error;
  }
}
