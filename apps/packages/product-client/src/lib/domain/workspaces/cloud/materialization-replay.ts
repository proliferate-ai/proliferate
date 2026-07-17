import type { MaterializeSequenceContext } from "#product/lib/domain/workspaces/cloud/open-on-mac-orchestration";
import type {
  CloudWorkspaceMaterializationSummary,
  CloudWorkspaceRepoRef,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import { materializationOperationIdFor } from "#product/lib/domain/workspaces/cloud/materialization-reconciliation";

/**
 * PR 6 — pure builder of the single-generation REPLAY context for an interrupted
 * materialization row. The replay must re-issue the EXACT `{rowId}:{generation}`
 * operation id root of the interrupted row (never a fresh `createIntent`, which
 * bumps the generation on the server → a new op, defeating idempotent replay).
 * The shared `runMaterializeAndReportSteps` then derives identical per-step ids
 * (`:repo-root` / `:workspace`), so PR 3's ledger replays deterministically with
 * no duplicate clone or worktree, and PR 4 re-reports the same hydrated outcome.
 *
 * Returns null when the row's source ref can't be reconstructed (no repo, no
 * head, or a repo-less workspace) — such a row is not safely replayable and is
 * left to the planner's missing/inconsistent diagnosis instead.
 */
export function buildReplayContext(args: {
  row: CloudWorkspaceMaterializationSummary;
  repo: CloudWorkspaceRepoRef | null;
}): MaterializeSequenceContext | null {
  const { row, repo } = args;
  if (!repo) {
    return null;
  }
  const branchName = row.observedBranch ?? repo.branch;
  const headSha = row.expectedHeadSha ?? row.observedHeadSha;
  if (!branchName || !headSha) {
    return null;
  }
  return {
    operationId: materializationOperationIdFor(row.id, row.generation),
    materializationId: row.id,
    generation: row.generation,
    repository: {
      provider: repo.provider,
      owner: repo.owner,
      name: repo.name,
      branch: repo.branch,
      baseBranch: repo.baseBranch,
    },
    branchName,
    headSha,
  };
}
