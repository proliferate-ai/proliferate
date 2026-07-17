import type { RepoRoot } from "@anyharness/sdk";
import { canonicalRepoKey } from "@proliferate/product-domain/repos/repo-id";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "#product/lib/infra/measurement/measurement-port";

function resolveRepoName(repoRoot: RepoRoot): string {
  return repoRoot.displayName?.trim()
    || repoRoot.remoteRepoName?.trim()
    || repoRoot.path.split("/").filter(Boolean).pop()
    || "Repository";
}

/** The GitHub identity a folder must prove before registering it for a known
 * Cloud repository ("Add to this Mac"). */
export interface ExpectedRepoIdentity {
  gitProvider: string;
  gitOwner: string;
  gitRepoName: string;
}

/** Thrown when the resolved folder is not the expected repository. The caller
 * renders expected/actual copy and performs no mutation. */
export class AddRepoIdentityMismatchError extends Error {
  constructor(
    readonly expected: ExpectedRepoIdentity,
    readonly actual: ExpectedRepoIdentity | null,
  ) {
    super(
      actual
        ? `Selected folder is ${actual.gitOwner}/${actual.gitRepoName}, not `
          + `${expected.gitOwner}/${expected.gitRepoName}.`
        : `Selected folder is not the GitHub repository `
          + `${expected.gitOwner}/${expected.gitRepoName}.`,
    );
    this.name = "AddRepoIdentityMismatchError";
  }
}

function repoRootIdentity(repoRoot: RepoRoot): ExpectedRepoIdentity | null {
  const gitProvider = repoRoot.remoteProvider?.trim();
  const gitOwner = repoRoot.remoteOwner?.trim();
  const gitRepoName = repoRoot.remoteRepoName?.trim();
  if (!gitProvider || !gitOwner || !gitRepoName) {
    return null;
  }
  return { gitProvider, gitOwner, gitRepoName };
}

export interface RunAddRepoWorkflowArgs {
  path: string;
  ensureRuntimeReady: () => Promise<string>;
  resolveRepoRootFromPath: (path: string) => Promise<RepoRoot>;
  /** When set, the resolved folder must be this exact repository (canonical
   * comparison) or the workflow throws before any mutation. */
  expectedRepoIdentity?: ExpectedRepoIdentity | null;
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
  expectedRepoIdentity = null,
  upsertRepoRootInWorkspaceCollections,
  invalidateWorkspaceCollections,
  saveLocalRepoEnvironment,
  unhideRepoRoot,
  openRepoSetupModal,
}: RunAddRepoWorkflowArgs): Promise<RepoRoot> {
  const runtimeUrl = await ensureRuntimeReady();
  const repoRoot = await resolveRepoRootFromPath(path);

  // "Add to this Mac": prove the folder is the expected repository BEFORE any
  // cache/registration/save mutation. AnyHarness already rejects worktrees
  // (REPO_ROOT_WORKTREE_UNSUPPORTED) upstream in resolveRepoRootFromPath.
  if (expectedRepoIdentity) {
    const actual = repoRootIdentity(repoRoot);
    const matches = actual
      && canonicalRepoKey(actual.gitProvider, actual.gitOwner, actual.gitRepoName)
        === canonicalRepoKey(
          expectedRepoIdentity.gitProvider,
          expectedRepoIdentity.gitOwner,
          expectedRepoIdentity.gitRepoName,
        );
    if (!matches) {
      throw new AddRepoIdentityMismatchError(expectedRepoIdentity, actual);
    }
  }

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
