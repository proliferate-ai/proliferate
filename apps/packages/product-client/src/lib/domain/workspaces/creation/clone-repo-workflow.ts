import type { RepoRoot } from "@anyharness/sdk";
import type { MaterializeRepoRootRequest } from "@anyharness/sdk";
import { canonicalRepoKey } from "@proliferate/product-domain/repos/repo-id";
import {
  AddRepoIdentityMismatchError,
  type ExpectedRepoIdentity,
} from "#product/lib/domain/workspaces/creation/add-repo-workflow";

/**
 * The canonical, un-credentialed HTTPS clone URL for a GitHub repository. The
 * PR 3 contract rejects a credentialed clone URL outright (userinfo in the URL
 * → 400 REPOSITORY_AUTH_REQUIRED); local clone authenticates only through the
 * local Git credential chain, so a token is never injected here.
 */
export function githubHttpsCloneUrl(owner: string, repoName: string): string {
  return `https://github.com/${owner}/${repoName}.git`;
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

export interface RunCloneRepoWorkflowArgs {
  /** The authorized GitHub repository to clone. */
  repo: ExpectedRepoIdentity;
  /** Absolute destination path the user chose for the clone. */
  destinationPath: string;
  /** Stable idempotency key reused across retries so a crash mid-clone reuses
   * the same repo-root materialization instead of cloning twice. */
  operationId: string;
  ensureRuntimeReady: () => Promise<string>;
  /** PR 3 clone-or-adopt materialization. */
  materializeRepoRoot: (input: MaterializeRepoRootRequest) => Promise<{ repoRoot: RepoRoot }>;
  upsertRepoRootInWorkspaceCollections: (runtimeUrl: string, repoRoot: RepoRoot) => void;
  invalidateWorkspaceCollections: (runtimeUrl: string) => Promise<unknown>;
  /** Best-effort target-scoped local environment save; a failure never blocks
   * the clone (local registration stays usable when Cloud is unavailable). */
  saveLocalRepoEnvironment?: (repoRoot: RepoRoot) => void;
  unhideRepoRoot: (repoRootId: string) => void;
}

/**
 * Flow 1: clone an authorized GitHub repository to this machine.
 *
 * Acquires the repository through PR 3's clone-or-adopt materialization, then
 * verifies the returned repo-root identity matches the requested repository
 * BEFORE any registration/save (a wrong adopted repo performs no mutation and
 * no Cloud report). On success it registers the repo root, best-effort saves
 * the target-scoped local environment, and invalidates the local collections
 * so one repo group appears.
 */
export async function runCloneRepoWorkflow(
  args: RunCloneRepoWorkflowArgs,
): Promise<RepoRoot> {
  const runtimeUrl = await args.ensureRuntimeReady();

  const { repoRoot } = await args.materializeRepoRoot({
    operationId: args.operationId,
    destinationPath: args.destinationPath,
    mode: "clone_or_adopt",
    repository: {
      provider: "github",
      owner: args.repo.gitOwner,
      name: args.repo.gitRepoName,
      cloneUrl: githubHttpsCloneUrl(args.repo.gitOwner, args.repo.gitRepoName),
    },
  });

  // Verify returned repo identity before mutating anything (wrong adopted repo
  // → no registration, no Cloud report).
  const actual = repoRootIdentity(repoRoot);
  const matches = actual
    && canonicalRepoKey(actual.gitProvider, actual.gitOwner, actual.gitRepoName)
      === canonicalRepoKey(args.repo.gitProvider, args.repo.gitOwner, args.repo.gitRepoName);
  if (!matches) {
    throw new AddRepoIdentityMismatchError(args.repo, actual);
  }

  args.upsertRepoRootInWorkspaceCollections(runtimeUrl, repoRoot);
  args.unhideRepoRoot(repoRoot.id);
  args.saveLocalRepoEnvironment?.(repoRoot);
  await args.invalidateWorkspaceCollections(runtimeUrl);
  return repoRoot;
}
