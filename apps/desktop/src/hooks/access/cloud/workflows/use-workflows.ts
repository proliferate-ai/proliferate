import { useQuery } from "@tanstack/react-query";
// Side-effect: registers the auth-aware desktop cloud client factory.
import "@/lib/access/cloud/client";
import {
  getWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  listWorkflows,
  type WorkflowDetailResponse,
  type WorkflowListResponse,
  type WorkflowRunDetailResponse,
  type WorkflowRunListResponse,
} from "@/lib/access/cloud/workflows";
import { coerceRunStatus, shouldPollRun } from "@proliferate/product-domain/workflows/run-status";
import {
  workflowDetailKey,
  workflowRunDetailKey,
  workflowRunsKey,
  workflowsListKey,
} from "./query-keys";

const RUN_POLL_INTERVAL_MS = 2500;

export function useWorkflows(includeArchived = false, enabled = true) {
  return useQuery<WorkflowListResponse>({
    queryKey: workflowsListKey(includeArchived),
    queryFn: () => listWorkflows(includeArchived),
    enabled,
  });
}

export function useWorkflowDetail(workflowId: string | null, enabled = true) {
  return useQuery<WorkflowDetailResponse>({
    queryKey: workflowDetailKey(workflowId),
    queryFn: () => getWorkflow(workflowId!),
    enabled: enabled && workflowId !== null,
  });
}

/** Runs for one workflow, or all runs when `workflowId` is null. */
export function useWorkflowRuns(workflowId: string | null = null, enabled = true) {
  return useQuery<WorkflowRunListResponse>({
    queryKey: workflowRunsKey(workflowId),
    queryFn: () => listWorkflowRuns(workflowId ?? undefined),
    enabled,
    refetchInterval: enabled ? RUN_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
}

/**
 * A single run (+ its step-effect ledger, spec 1.2), polled on an interval
 * while it is non-terminal (spec 3.6: simple interval, no streaming in v1).
 * Polling stops once the run resolves.
 */
export function useWorkflowRun(runId: string | null, enabled = true) {
  return useQuery<WorkflowRunDetailResponse>({
    queryKey: workflowRunDetailKey(runId),
    queryFn: () => getWorkflowRun(runId!),
    enabled: enabled && runId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      if (status && !shouldPollRun(coerceRunStatus(status))) {
        return false;
      }
      return RUN_POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
  });
}
