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
 * the stable idempotency root. PR 3's ledger keys `local_materialization_operation`
 * by a single `operation_id` PRIMARY KEY across BOTH the repo-root and workspace
 * steps, and rejects a reused id whose request-hash (which encodes the step kind)
 * differs with MATERIALIZATION_OPERATION_CONFLICT. So the two steps must NOT share
 * one id: we derive distinct, deterministic per-step ids from the root
 * (`"{operationId}:repo-root"` and `"{operationId}:workspace"`). Deterministic so a
 * crash-retry re-issues the SAME per-step ids and replays PR 3's ledger result
 * (never a second clone or worktree). The hydrated report carries the exact
 * observed HEAD/branch the runtime returned. See PR5-OPID-05.
 */

/** Deterministic per-step operation ids derived from the Cloud-issued root, so a
 * crash-retry reuses each step's id (PR 3 replay) while the repo-root and workspace
 * steps never collide on one id (which would be an OPERATION_CONFLICT). */
export function repoRootOperationId(rootOperationId: string): string {
  return `${rootOperationId}:repo-root`;
}
export function workspaceOperationId(rootOperationId: string): string {
  return `${rootOperationId}:workspace`;
}

export interface OpenOnMacRepoRootSource {
  /** An existing local repo root that already hosts this repository, or null to
   * clone one first. */
  existingRepoRootId: string | null;
  /** Destination path for a fresh clone when no existing repo root matches.
   * Required when existingRepoRootId is null. */
  cloneDestinationPath?: string | null;
  /** Recreate mode (Flow 5): force a brand-new worktree instead of reusing or
   * adopting an existing one. When set, a deterministic per-generation
   * destination id is threaded into PR 3's exact-ref materialization so the
   * worktree lands at a fresh managed path; leaving it unset lets PR 3
   * reuse/adopt an existing clean checkout at the ref (relink / open). Derived
   * from the generation-bearing operation id so a crash-retry of the SAME
   * recreate reuses the SAME fresh path (PR5-MODE-03). */
  forceFreshWorktree?: boolean;
}

/** A PR 3 `destinationId` is a single path segment (`[A-Za-z0-9._-]`, ≤96). Turn
 * the generation-bearing operation id into one so recreate targets a fresh,
 * deterministic managed path per generation. */
function recreateDestinationId(rootOperationId: string): string {
  const sanitized = rootOperationId.replace(/[^A-Za-z0-9._-]/gu, "-");
  return `recreate-${sanitized}`.slice(0, 96);
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

/** The exact source ref + operation id a materialize→report sequence needs. For
 * a fresh Open/relink it comes from `createIntent()`; for a single-generation
 * REPLAY it comes verbatim from the interrupted ledger row (`"{rowId}:{gen}"`),
 * so PR 3's per-step ids are identical and its ledger replays idempotently. */
export interface MaterializeSequenceContext {
  operationId: string;
  materializationId: string;
  generation: number;
  repository: MaterializationIntentResponse["source"]["repository"];
  branchName: string;
  headSha: string;
}

/**
 * Run the (clone repo root if needed) → exact-ref materialize → report steps for
 * a resolved operation context. Shared by the fresh Open/relink flow and the
 * reconciliation REPLAY so there is ONE orchestration: replay simply supplies an
 * existing row's `{rowId}:{generation}` as the context instead of minting a new
 * intent, guaranteeing identical per-step ids (`:repo-root`/`:workspace`).
 */
export async function runMaterializeAndReportSteps(
  context: MaterializeSequenceContext,
  source: OpenOnMacRepoRootSource,
  callbacks: Pick<OpenOnMacCallbacks, "materializeRepoRoot" | "materializeWorkspaceAtRef" | "report">,
): Promise<OpenOnMacResult> {
  const { operationId, repository, branchName, headSha } = context;

  let repoRootId = source.existingRepoRootId;
  if (!repoRootId) {
    if (!source.cloneDestinationPath) {
      throw new Error("A destination path is required to clone the repository.");
    }
    const { repoRoot } = await callbacks.materializeRepoRoot({
      operationId: repoRootOperationId(operationId),
      destinationPath: source.cloneDestinationPath,
      mode: "clone_or_adopt",
      repository: {
        provider: "github",
        owner: repository.owner,
        name: repository.name,
        cloneUrl: githubHttpsCloneUrl(repository.owner, repository.name),
      },
    });
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

  const materialized = await callbacks.materializeWorkspaceAtRef(repoRootId, {
    operationId: workspaceOperationId(operationId),
    branchName,
    headSha,
    destinationId: source.forceFreshWorktree ? recreateDestinationId(operationId) : undefined,
  });

  await callbacks.report(context.materializationId, {
    generation: context.generation,
    state: "hydrated",
    anyharnessWorkspaceId: materialized.workspaceId,
    worktreePath: materialized.worktreePath,
    observedBranch: branchName,
    observedHeadSha: materialized.observedHeadSha,
  });

  return {
    materializationId: context.materializationId,
    anyharnessWorkspaceId: materialized.workspaceId,
    worktreePath: materialized.worktreePath,
  };
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
  return runMaterializeAndReportSteps(
    {
      operationId: intent.operationId,
      materializationId: intent.materialization.id,
      generation: intent.materialization.generation,
      repository: intent.source.repository,
      branchName: intent.source.branchName,
      headSha: intent.source.headSha,
    },
    source,
    callbacks,
  );
}
