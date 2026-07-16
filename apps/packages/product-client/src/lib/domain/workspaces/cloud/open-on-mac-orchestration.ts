import type {
  MaterializationIntentResponse,
  ReportMaterializationRequest,
} from "@proliferate/cloud-sdk/types";
import type {
  MaterializeRepoRootRequest,
  MaterializeWorkspaceAtRefRequest,
  RepoRoot,
} from "@anyharness/sdk";
import { canonicalRepoKey } from "@proliferate/product-domain/repos/repo-id";
import { githubHttpsCloneUrl } from "#product/lib/domain/workspaces/creation/clone-repo-workflow";

/**
 * Crash-safe "Open on this Mac" orchestration (Flow 2), and the identical
 * relink path (Flow 5). Pure: it receives already-resolved SDK/AnyHarness
 * callbacks and sequences them, so ordering and idempotency are unit-testable.
 *
 * The invariant: the Cloud-issued `operationId` (`"{rowId}:{generation}"`) is
 * threaded verbatim into PR 3's materialization operation id and reused across
 * retries. PR 3's ledger makes AnyHarness idempotent, so a crash after the
 * worktree is created but before the report retries onto the same worktree and
 * reports it — never a second worktree. The hydrated report carries the exact
 * observed HEAD/branch the runtime returned.
 */

export interface OpenOnMacRepoRootSource {
  /** An existing local repo root that already hosts this repository, or null to
   * clone one first. */
  existingRepoRootId: string | null;
  /** Destination path for a fresh clone when no existing repo root matches.
   * Required when existingRepoRootId is null. */
  cloneDestinationPath?: string | null;
}

export interface OpenOnMacCallbacks {
  /** Create/reuse the Cloud local-materialization intent for this install. */
  createIntent: () => Promise<MaterializationIntentResponse>;
  /** Clone-or-adopt a repo root through PR 3 (only when no existing root). */
  materializeRepoRoot: (input: MaterializeRepoRootRequest) => Promise<{ repoRoot: RepoRoot }>;
  /** Materialize the exact-ref workspace through PR 3. */
  materializeWorkspaceAtRef: (
    repoRootId: string,
    input: MaterializeWorkspaceAtRefRequest,
  ) => Promise<{ workspaceId: string; observedHeadSha: string; worktreePath: string }>;
  /** Report the outcome back to Cloud. */
  report: (materializationId: string, body: ReportMaterializationRequest) => Promise<unknown>;
}

export interface OpenOnMacResult {
  materializationId: string;
  anyharnessWorkspaceId: string;
  worktreePath: string;
}

/**
 * Run the intent → (clone repo root if needed) → exact-ref materialize →
 * report sequence. Returns the local AnyHarness workspace id so the caller can
 * select/open it. Throws on any step failure; the pending intent is left for a
 * safe retry (same operation id → no duplicate worktree).
 */
export async function runOpenOnMacFlow(
  source: OpenOnMacRepoRootSource,
  callbacks: OpenOnMacCallbacks,
): Promise<OpenOnMacResult> {
  const intent = await callbacks.createIntent();
  const operationId = intent.operationId;
  const { repository, branchName, headSha } = intent.source;

  let repoRootId = source.existingRepoRootId;
  if (!repoRootId) {
    if (!source.cloneDestinationPath) {
      throw new Error("A destination path is required to clone the repository.");
    }
    const { repoRoot } = await callbacks.materializeRepoRoot({
      // Reuse the Cloud operation id so a crash mid-clone reuses the repo-root
      // materialization rather than cloning twice.
      operationId,
      destinationPath: source.cloneDestinationPath,
      mode: "clone_or_adopt",
      repository: {
        provider: "github",
        owner: repository.owner,
        name: repository.name,
        cloneUrl: githubHttpsCloneUrl(repository.owner, repository.name),
      },
    });
    // Guard against adopting the wrong repository.
    const matches = repoRoot.remoteProvider && repoRoot.remoteOwner && repoRoot.remoteRepoName
      && canonicalRepoKey(repoRoot.remoteProvider, repoRoot.remoteOwner, repoRoot.remoteRepoName)
        === canonicalRepoKey(repository.provider, repository.owner, repository.name);
    if (!matches) {
      throw new Error(
        `Cloned repository does not match ${repository.owner}/${repository.name}.`,
      );
    }
    repoRootId = repoRoot.id;
  }

  let materialized: { workspaceId: string; observedHeadSha: string; worktreePath: string };
  try {
    materialized = await callbacks.materializeWorkspaceAtRef(repoRootId, {
      operationId,
      branchName,
      headSha,
    });
  } catch (error) {
    // Leave the intent pending for a safe retry (same operation id reuses the
    // ledger result). Do not report a failure that would look like a durable
    // materialization failure to the server.
    throw error;
  }

  await callbacks.report(intent.materialization.id, {
    generation: intent.materialization.generation,
    state: "hydrated",
    anyharnessWorkspaceId: materialized.workspaceId,
    worktreePath: materialized.worktreePath,
    observedBranch: branchName,
    observedHeadSha: materialized.observedHeadSha,
  });

  return {
    materializationId: intent.materialization.id,
    anyharnessWorkspaceId: materialized.workspaceId,
    worktreePath: materialized.worktreePath,
  };
}
