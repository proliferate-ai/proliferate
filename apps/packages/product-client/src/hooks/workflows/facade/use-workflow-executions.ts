import { useMemo } from "react";
import type { WorkflowRunV2 } from "@anyharness/sdk";
import { useWorkflowRunsQuery } from "@anyharness/sdk-react";
import { selectWorkflowExecutionRows } from "#product/domain/workflows/main-view-model";
import { isWorkflowsV2Enabled } from "#product/lib/domain/capabilities/workflows-v2";

/** Stable empty list: `data?.runs ?? []` would mint a new array every render. */
const NO_RUNS: WorkflowRunV2[] = [];

/**
 * The main page's Executions group: every run this runtime knows about,
 * across every workspace, newest first. The same `GET /v1/workflow-runs`
 * roster the resume scan reads (workspace-unscoped `useWorkflowRunsQuery`),
 * watched rather than read once so a run that is still moving keeps its row
 * current while the page is open.
 *
 * Failure is deliberately quiet at this layer: the definitions list is the
 * page's primary content and must not fail with it, so the caller renders no
 * group (rather than an error state) when the roster cannot be read.
 */
export function useWorkflowExecutions(): {
  runs: WorkflowRunV2[];
  loaded: boolean;
} {
  const enabled = isWorkflowsV2Enabled();
  const query = useWorkflowRunsQuery(undefined, { enabled, watchActiveRuns: true });
  const runs = useMemo(
    () => (query.data ? selectWorkflowExecutionRows(query.data.runs) : NO_RUNS),
    [query.data],
  );
  return { runs, loaded: query.data !== undefined };
}
