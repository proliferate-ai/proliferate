/** Query-key factory for cloud workflow queries. */

export function workflowsRootKey() {
  return ["cloud", "workflows"] as const;
}

export function workflowsListKey(includeArchived = false) {
  return [...workflowsRootKey(), "list", includeArchived] as const;
}

export function workflowDetailKey(workflowId: string | null) {
  return [...workflowsRootKey(), "detail", workflowId] as const;
}

export function workflowRunsKey(workflowId: string | null) {
  return [...workflowsRootKey(), "runs", workflowId] as const;
}

export function workflowRunDetailKey(runId: string | null) {
  return [...workflowsRootKey(), "run", runId] as const;
}

export function workflowTriggersKey(workflowId: string | null) {
  return [...workflowsRootKey(), "triggers", workflowId] as const;
}
