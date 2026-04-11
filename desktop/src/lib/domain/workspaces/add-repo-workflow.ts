import type { RepoRoot, ResolveWorkspaceResponse, Workspace } from "@anyharness/sdk";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/collections";
import { upsertLocalWorkspaceCollections } from "@/lib/domain/workspaces/collections";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";

function resolveRepoName(workspace: Workspace, repoRoot: RepoRoot): string {
  return repoRoot.displayName?.trim()
    || repoRoot.remoteRepoName?.trim()
    || workspace.gitRepoName
    || workspace.sourceRepoRootPath?.split("/").filter(Boolean).pop()
    || repoRoot.path.split("/").filter(Boolean).pop()
    || "Repository";
}

export interface AddRepoWorkflowQueryClient {
  // Keep this shape structural so the workflow can be exercised with small test doubles.
  setQueriesData: (
    filters: { queryKey: readonly unknown[] },
    updater: (collections: WorkspaceCollections | undefined) => WorkspaceCollections | undefined,
  ) => void;
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<unknown>;
}

export interface RunAddRepoWorkflowArgs {
  path: string;
  queryClient: AddRepoWorkflowQueryClient;
  ensureRuntimeReady: () => Promise<string>;
  resolveWorkspaceFromPath: (path: string) => Promise<ResolveWorkspaceResponse>;
  unarchiveWorkspace: (workspaceId: string) => void;
  openRepoSetupModal: (state: {
    workspaceId: string;
    sourceRoot: string;
    repoName: string;
  }) => void;
  workspaceCollectionsScopeKey: (runtimeUrl: string) => readonly unknown[];
}

export async function runAddRepoWorkflow({
  path,
  queryClient,
  ensureRuntimeReady,
  resolveWorkspaceFromPath,
  unarchiveWorkspace,
  openRepoSetupModal,
  workspaceCollectionsScopeKey,
}: RunAddRepoWorkflowArgs): Promise<void> {
  const runtimeUrl = await ensureRuntimeReady();
  const { repoRoot, workspace } = await resolveWorkspaceFromPath(path);
  const collectionsScopeKey = workspaceCollectionsScopeKey(runtimeUrl);

  const cacheUpsertStartedAt = startLatencyTimer();
  queryClient.setQueriesData(
    { queryKey: collectionsScopeKey },
    (collections) => upsertLocalWorkspaceCollections(collections, workspace, repoRoot),
  );
  logLatency("workspace.collections.cache_upsert", {
    source: "repo_register",
    workspaceId: workspace.id,
    workspaceKind: workspace.kind,
    elapsedMs: elapsedMs(cacheUpsertStartedAt),
  });

  unarchiveWorkspace(workspace.id);
  const invalidateStartedAt = startLatencyTimer();
  await queryClient.invalidateQueries({
    queryKey: collectionsScopeKey,
  });
  logLatency("workspace.collections.invalidate.success", {
    source: "repo_register",
    workspaceId: workspace.id,
    runtimeUrl,
    elapsedMs: elapsedMs(invalidateStartedAt),
  });
  openRepoSetupModal({
    workspaceId: workspace.id,
    sourceRoot: repoRoot.path,
    repoName: resolveRepoName(workspace, repoRoot),
  });
}
