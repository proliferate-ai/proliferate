import type { RepoRoot } from "@anyharness/sdk";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/collections";
import { upsertRepoRootCollections } from "@/lib/domain/workspaces/collections";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";

function resolveRepoName(repoRoot: RepoRoot): string {
  return repoRoot.displayName?.trim()
    || repoRoot.remoteRepoName?.trim()
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
  resolveRepoRootFromPath: (path: string) => Promise<RepoRoot>;
  unhideRepoRoot: (repoRootId: string) => void;
  openRepoSetupModal: (state: {
    repoRootId: string;
    sourceRoot: string;
    repoName: string;
  }) => void;
  workspaceCollectionsScopeKey: (runtimeUrl: string) => readonly unknown[];
}

export async function runAddRepoWorkflow({
  path,
  queryClient,
  ensureRuntimeReady,
  resolveRepoRootFromPath,
  unhideRepoRoot,
  openRepoSetupModal,
  workspaceCollectionsScopeKey,
}: RunAddRepoWorkflowArgs): Promise<void> {
  const runtimeUrl = await ensureRuntimeReady();
  const repoRoot = await resolveRepoRootFromPath(path);
  const collectionsScopeKey = workspaceCollectionsScopeKey(runtimeUrl);

  const cacheUpsertStartedAt = startLatencyTimer();
  queryClient.setQueriesData(
    { queryKey: collectionsScopeKey },
    (collections) => upsertRepoRootCollections(collections, repoRoot),
  );
  logLatency("workspace.collections.cache_upsert", {
    source: "repo_register",
    repoRootId: repoRoot.id,
    elapsedMs: elapsedMs(cacheUpsertStartedAt),
  });

  unhideRepoRoot(repoRoot.id);
  const invalidateStartedAt = startLatencyTimer();
  await queryClient.invalidateQueries({
    queryKey: collectionsScopeKey,
  });
  logLatency("workspace.collections.invalidate.success", {
    source: "repo_register",
    repoRootId: repoRoot.id,
    runtimeUrl,
    elapsedMs: elapsedMs(invalidateStartedAt),
  });
  openRepoSetupModal({
    repoRootId: repoRoot.id,
    sourceRoot: repoRoot.path,
    repoName: resolveRepoName(repoRoot),
  });
}
