import { useMemo } from "react";
import { useWorkflowRunQuery, useWorkflowRunsQuery } from "@anyharness/sdk-react";
import type { WorkflowRunProjectionV2, WorkflowRunV2 } from "@anyharness/sdk";
import { CHAT_CONTEXT_DOC_MENTION_RUN_LIMIT } from "#product/config/chat";
import { isFeatureEnabled } from "#product/config/feature-flags";
import { workflowRunDefinitionTitle } from "#product/domain/workflows/main-view-model";
import { workflowRunIsActive } from "#product/domain/workflows/run-view-model";
import { useWorkspaceFileContext } from "#product/hooks/workspaces/derived/files/use-workspace-file-context";
import {
  filterContextDocMentionCandidates,
  type ContextDocMentionCandidate,
} from "#product/lib/domain/chat/composer/context-doc-mention";

interface UseChatContextDocMentionSourceArgs {
  open: boolean;
  query: string;
}

/**
 * The `@` menu's second candidate source: the context docs registered to the
 * workspace's workflow runs.
 *
 * Docs ride only on the per-run projection, never on the runs list, so this
 * hook reads the list and then a bounded number of projections — the
 * `CHAT_CONTEXT_DOC_MENTION_RUN_LIMIT` newest runs, active runs first (the
 * same ordering the run rails use). The bound is what lets the projections be
 * a fixed set of hook calls, and every query is gated on the menu actually
 * being open, so an unopened composer costs nothing.
 *
 * Feature-flagged (`chatContextDocMentions`): OFF disables every query and
 * yields no candidates, leaving the mention menu file-only.
 */
export function useChatContextDocMentionSource({
  open,
  query,
}: UseChatContextDocMentionSourceArgs) {
  const sourceEnabled = isFeatureEnabled("chatContextDocMentions");
  const { materializedWorkspaceId } = useWorkspaceFileContext();
  const queriesEnabled = sourceEnabled && open && materializedWorkspaceId !== null;

  const runsQuery = useWorkflowRunsQuery(materializedWorkspaceId, {
    enabled: queriesEnabled,
  });
  const runs = runsQuery.data?.runs;

  const sourcedRuns = useMemo(
    () => selectMentionSourceRuns(runs ?? []),
    [runs],
  );

  // A fixed set of projection reads, not a loop: the run cap is a constant, so
  // the hook call count stays constant. Slots beyond the available runs hold
  // a null id and stay disabled.
  const projectionQueries = [
    useWorkflowRunQuery(sourcedRuns[0]?.id ?? null, { enabled: queriesEnabled }),
    useWorkflowRunQuery(sourcedRuns[1]?.id ?? null, { enabled: queriesEnabled }),
    useWorkflowRunQuery(sourcedRuns[2]?.id ?? null, { enabled: queriesEnabled }),
    useWorkflowRunQuery(sourcedRuns[3]?.id ?? null, { enabled: queriesEnabled }),
  ] as const;
  const [firstRun, secondRun, thirdRun, fourthRun] = projectionQueries.map(
    (projectionQuery) => projectionQuery.data,
  );

  const candidates = useMemo(() => {
    if (!queriesEnabled) {
      return [];
    }
    const collected: ContextDocMentionCandidate[] = [];
    for (const projection of [firstRun, secondRun, thirdRun, fourthRun]) {
      if (projection) {
        collected.push(...projectionCandidates(projection));
      }
    }
    return filterContextDocMentionCandidates(collected, query);
  }, [queriesEnabled, query, firstRun, secondRun, thirdRun, fourthRun]);

  return {
    candidates,
    sourceEnabled,
    isLoading: queriesEnabled
      && (runsQuery.isLoading || projectionQueries.some(
        (projectionQuery) => projectionQuery.isLoading,
      )),
  };
}

/**
 * Which runs the menu reads docs from: active runs first, then newest-first —
 * the list route already returns `created_at DESC`, so a stable partition by
 * activity preserves recency inside each half.
 */
function selectMentionSourceRuns(runs: readonly WorkflowRunV2[]): WorkflowRunV2[] {
  const active: WorkflowRunV2[] = [];
  const settled: WorkflowRunV2[] = [];
  for (const run of runs) {
    (workflowRunIsActive(run) ? active : settled).push(run);
  }
  return [...active, ...settled].slice(0, CHAT_CONTEXT_DOC_MENTION_RUN_LIMIT);
}

function projectionCandidates(
  projection: WorkflowRunProjectionV2,
): ContextDocMentionCandidate[] {
  const runLabel = workflowRunDefinitionTitle(projection.run.definitionJson);
  return projection.docs.map((doc) => ({
    docId: doc.id,
    runId: doc.runId,
    slug: doc.slug,
    filename: doc.filename,
    runLabel,
  }));
}
