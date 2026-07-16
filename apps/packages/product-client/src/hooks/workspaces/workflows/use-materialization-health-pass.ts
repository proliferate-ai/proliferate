import { useCallback, useRef } from "react";
import {
  getAnyHarnessClient,
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
  useMaterializeRepoRootMutation,
  useMaterializeWorkspaceAtRefMutation,
} from "@anyharness/sdk-react";
import { useReportMaterialization } from "@proliferate/cloud-sdk-react";
import {
  planMaterializationReconciliation,
  type LocalInventoryEntry,
  type MaterializationReconciliationAction,
} from "#product/lib/domain/workspaces/cloud/materialization-reconciliation";
import { buildReplayContext } from "#product/lib/domain/workspaces/cloud/materialization-replay";
import { runMaterializeAndReportSteps } from "#product/lib/domain/workspaces/cloud/open-on-mac-orchestration";
import { isStaleMaterializationGenerationError } from "#product/lib/domain/workspaces/cloud/materialization-report-error";
import { remoteRepoKey } from "#product/lib/domain/workspaces/cloud/logical-workspace-source";
import { useStandardRepoProjection } from "#product/hooks/workspaces/derived/use-standard-repo-projection";
import { useDesktopInstallId } from "#product/hooks/workspaces/derived/use-desktop-install-id";
import { useWorkspaceCollectionsInvalidationActions } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import type {
  CloudWorkspaceMaterializationSummary,
  CloudWorkspaceRepoRef,
  CloudWorkspaceSummary,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";

/**
 * PR 6 — the materialization reconciliation health pass. Runs on Desktop
 * startup, relevant workspace selection, and explicit Retry. It compares THIS
 * install's local_desktop materialization rows to the local AnyHarness inventory
 * (bounded to the passed workspaces — never an arbitrary repo scan) and issues
 * the derived reports/replays:
 *   - missing id/path      → PUT state:"missing"
 *   - branch/HEAD mismatch → PUT state:"inconsistent" with observed fields
 *   - interrupted op       → REPLAY the SAME {rowId}:{generation} operation via
 *                            the shared PR 5 orchestration (idempotent, no dup),
 *                            then the hydrated report the steps already emit
 *   - unreachable runtime  → association preserved, nothing reported
 *
 * The planning is pure (materialization-reconciliation.ts); this hook does the
 * I/O (read live git status, PUT reports, replay via runMaterializeAndReportSteps)
 * and query invalidation. It NEVER mutates a checkout for a report and NEVER PUTs
 * a re-`hydrated` for a mismatched head (a hard server 409 — §C-11).
 *
 * Thrash guard: a session-scoped memo suppresses re-PUTting the SAME state for
 * an unchanged (materializationId, generation, state) so repeated passes on
 * unchanged inputs are no-ops (the reviewer's idempotence flag).
 */
export function useMaterializationHealthPass() {
  const runtime = useAnyHarnessRuntimeContext();
  const desktopInstallId = useDesktopInstallId();
  const report = useReportMaterialization().mutateAsync;
  const materializeRepoRoot = useMaterializeRepoRootMutation().mutateAsync;
  const materializeWorkspaceAtRef = useMaterializeWorkspaceAtRefMutation().mutateAsync;
  const { localWorkspaces, repoRoots } = useStandardRepoProjection();
  const { invalidateWorkspaceCollectionsForRuntime } = useWorkspaceCollectionsInvalidationActions();
  // Session-scoped last-reported memo: materializationId → "generation:state".
  const reportedMemo = useRef<Map<string, string>>(new Map());

  return useCallback(async (
    cloudWorkspaces: CloudWorkspaceSummary[],
  ): Promise<MaterializationReconciliationAction[]> => {
    if (!desktopInstallId) {
      return [];
    }

    // Bounded inventory: only the current-install local_desktop rows and the
    // local workspaces already loaded in the projection.
    const localById = new Map(localWorkspaces.map((w) => [w.id, w]));
    const unreachable: string[] = [];
    const inventory: LocalInventoryEntry[] = [];
    const rows = cloudWorkspaces.flatMap((cloud) =>
      (cloud.materializations ?? [])
        .filter((m) => m.targetKind === "local_desktop" && m.desktopInstallId === desktopInstallId)
        .map((m) => ({ cloud, row: m })));

    const client = runtime.runtimeUrl
      ? getAnyHarnessClient(resolveRuntimeConnection(runtime))
      : null;

    for (const { row } of rows) {
      const localId = row.anyharnessWorkspaceId;
      if (!localId) {
        continue;
      }
      // Only workspaces present in the local projection are queried; a row whose
      // id is absent from the projection is left for the planner to mark missing.
      if (!localById.has(localId) || !client) {
        continue;
      }
      try {
        const status = await client.git.getStatus(localId);
        inventory.push({
          anyharnessWorkspaceId: localId,
          worktreePath: status.workspacePath,
          observedBranch: status.currentBranch ?? null,
          observedHeadSha: status.headOid,
        });
      } catch {
        // The runtime could not be queried for this id: preserve the record.
        unreachable.push(localId);
      }
    }

    const actions = planMaterializationReconciliation({
      rows: rows.map(({ row }) => row),
      inventory,
      unreachableAnyharnessWorkspaceIds: unreachable,
    });

    let didMutate = false;
    for (const { cloud, row } of rows) {
      const action = actions.find((a) => a.materializationId === row.id);
      if (!action) {
        continue;
      }

      if (action.report) {
        // Thrash guard: skip a re-PUT of the SAME (generation, state) this session.
        const memoKey = `${action.generation}:${action.report.state}`;
        if (reportedMemo.current.get(row.id) === memoKey) {
          continue;
        }
        try {
          await report({ workspaceId: cloud.id, materializationId: row.id, body: action.report });
          reportedMemo.current.set(row.id, memoKey);
          didMutate = true;
        } catch (error) {
          // A stale generation means the association already moved on — quiet.
          // Other errors are best-effort; the pass never throws to the caller.
          if (isStaleMaterializationGenerationError(error)) {
            reportedMemo.current.set(row.id, memoKey);
          }
        }
        continue;
      }

      if (action.kind === "replay-operation") {
        const replayed = await runReplayAction({
          cloudWorkspaceId: cloud.id,
          repo: cloud.repo,
          row,
          repoRoots,
          materializeRepoRoot,
          materializeWorkspaceAtRef,
          report,
        });
        if (replayed) {
          didMutate = true;
        }
      }
    }

    if (didMutate) {
      const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
      if (runtimeUrl) {
        await invalidateWorkspaceCollectionsForRuntime(runtimeUrl);
      }
    }
    return actions;
  }, [
    desktopInstallId,
    invalidateWorkspaceCollectionsForRuntime,
    localWorkspaces,
    materializeRepoRoot,
    materializeWorkspaceAtRef,
    report,
    repoRoots,
    runtime,
  ]);
}

/**
 * Execute a single-generation replay of an interrupted materialization via the
 * shared orchestration. Resolves an existing repo root that already hosts the
 * repo (never clones during a background health pass — a missing root is left
 * for explicit recovery); re-issues the EXACT {rowId}:{generation} op id so PR 3
 * replays idempotently. Returns true when the replay reported hydrated.
 */
async function runReplayAction(args: {
  cloudWorkspaceId: string;
  repo: CloudWorkspaceRepoRef | null;
  row: CloudWorkspaceMaterializationSummary;
  repoRoots: ReturnType<typeof useStandardRepoProjection>["repoRoots"];
  materializeRepoRoot: ReturnType<typeof useMaterializeRepoRootMutation>["mutateAsync"];
  materializeWorkspaceAtRef: ReturnType<typeof useMaterializeWorkspaceAtRefMutation>["mutateAsync"];
  report: ReturnType<typeof useReportMaterialization>["mutateAsync"];
}): Promise<boolean> {
  const context = buildReplayContext({ row: args.row, repo: args.repo });
  if (!context) {
    return false;
  }
  const key = remoteRepoKey(context.repository.provider, context.repository.owner, context.repository.name);
  const existingRepoRoot = args.repoRoots.find(
    (root) =>
      root.remoteProvider
      && root.remoteOwner
      && root.remoteRepoName
      && remoteRepoKey(root.remoteProvider, root.remoteOwner, root.remoteRepoName) === key,
  );
  if (!existingRepoRoot) {
    // No local repo root hosts this repo: do not silently clone in a background
    // pass. Explicit relink/recreate owns that path.
    return false;
  }
  try {
    await runMaterializeAndReportSteps(
      context,
      { existingRepoRootId: existingRepoRoot.id },
      {
        materializeRepoRoot: (input) => args.materializeRepoRoot(input),
        materializeWorkspaceAtRef: async (repoRootId, input) => {
          const response = await args.materializeWorkspaceAtRef({ repoRootId, input });
          return {
            workspaceId: response.workspace.id,
            observedHeadSha: response.observedHeadSha,
            worktreePath: response.workspace.path,
          };
        },
        report: (materializationId, body) =>
          args.report({ workspaceId: args.cloudWorkspaceId, materializationId, body }),
      },
    );
    return true;
  } catch (error) {
    // Best-effort; a stale generation or transient failure leaves the row for a
    // later pass. Never throw from the health pass.
    if (isStaleMaterializationGenerationError(error)) {
      return true;
    }
    return false;
  }
}
