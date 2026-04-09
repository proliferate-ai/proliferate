import type { Workspace } from "@anyharness/sdk";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/collections";
import { upsertLocalWorkspaceCollections } from "@/lib/domain/workspaces/collections";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";

function resolveRepoName(workspace: Workspace): string {
  return workspace.gitRepoName
    ?? workspace.sourceRepoRootPath.split("/").filter(Boolean).pop()
    ?? "Repository";
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
  registerRepoWorkspace: (input: {
    path: string;
    connection: { runtimeUrl: string };
  }) => Promise<Workspace>;
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
  registerRepoWorkspace,
  unarchiveWorkspace,
  openRepoSetupModal,
  workspaceCollectionsScopeKey,
}: RunAddRepoWorkflowArgs): Promise<void> {
  const runtimeUrl = await ensureRuntimeReady();
  const workspace = await registerRepoWorkspace({
    path,
    connection: { runtimeUrl },
  });
  const collectionsScopeKey = workspaceCollectionsScopeKey(runtimeUrl);

  const cacheUpsertStartedAt = startLatencyTimer();
  queryClient.setQueriesData(
    { queryKey: collectionsScopeKey },
    (collections) => upsertLocalWorkspaceCollections(collections, workspace),
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
    sourceRoot: workspace.sourceRepoRootPath,
    repoName: resolveRepoName(workspace),
  });
}
