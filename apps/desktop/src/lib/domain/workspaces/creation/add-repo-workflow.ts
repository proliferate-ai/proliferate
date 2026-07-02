import type { RepoRoot } from "@anyharness/sdk";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";

function resolveRepoName(repoRoot: RepoRoot): string {
  return repoRoot.displayName?.trim()
    || repoRoot.remoteRepoName?.trim()
    || repoRoot.path.split("/").filter(Boolean).pop()
    || "Repository";
}

export interface RunAddRepoWorkflowArgs {
  path: string;
  ensureRuntimeReady: () => Promise<string>;
  resolveRepoRootFromPath: (path: string) => Promise<RepoRoot>;
  upsertRepoRootInWorkspaceCollections: (runtimeUrl: string, repoRoot: RepoRoot) => void;
  invalidateWorkspaceCollections: (runtimeUrl: string) => Promise<unknown>;
  saveLocalRepoEnvironment?: (repoRoot: RepoRoot) => void;
  unhideRepoRoot: (repoRootId: string) => void;
  openRepoSetupModal: (state: {
    sourceRoot: string;
    repoName: string;
  }) => void;
}

export async function runAddRepoWorkflow({
  path,
  ensureRuntimeReady,
  resolveRepoRootFromPath,
  upsertRepoRootInWorkspaceCollections,
  invalidateWorkspaceCollections,
  saveLocalRepoEnvironment,
  unhideRepoRoot,
  openRepoSetupModal,
}: RunAddRepoWorkflowArgs): Promise<RepoRoot> {
  const runtimeUrl = await ensureRuntimeReady();
  const repoRoot = await resolveRepoRootFromPath(path);

  const cacheUpsertStartedAt = startLatencyTimer();
  upsertRepoRootInWorkspaceCollections(runtimeUrl, repoRoot);
  logLatency("workspace.collections.cache_upsert", {
    source: "repo_register",
    repoRootId: repoRoot.id,
    elapsedMs: elapsedMs(cacheUpsertStartedAt),
  });

  unhideRepoRoot(repoRoot.id);
  saveLocalRepoEnvironment?.(repoRoot);
  const invalidateStartedAt = startLatencyTimer();
  await invalidateWorkspaceCollections(runtimeUrl);
  logLatency("workspace.collections.invalidate.success", {
    source: "repo_register",
    repoRootId: repoRoot.id,
    runtimeUrl,
    elapsedMs: elapsedMs(invalidateStartedAt),
  });
  openRepoSetupModal({
    sourceRoot: repoRoot.path,
    repoName: resolveRepoName(repoRoot),
  });
  return repoRoot;
}
