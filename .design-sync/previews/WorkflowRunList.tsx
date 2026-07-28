import { WorkflowRunList } from "@proliferate/ui";

/**
 * `WorkflowRunList` is its own bordered card (not a scroll shell), so it only
 * needs a page-width column. Each row's status label/tone comes from the domain
 * `workflowHistoryItemPresentation` — the fixtures below cover the delivery,
 * execution, cancellation and target-lost branches it can produce.
 */
function historyItem(overrides) {
  return {
    id: "run-1",
    workflowDefinitionId: "wf-triage",
    definitionRevision: 4,
    title: "Issue triage",
    placementKind: "scratch",
    targetKind: "managedCloud",
    deliveryStatus: "accepted",
    desiredState: "active",
    executionStatus: null,
    freshness: "fresh",
    latestObservedAt: "2026-07-24T16:31:00Z",
    cloudWorkspaceId: "cw-8813",
    sessionId: "sess-4471",
    createdAt: "2026-07-24T16:20:00Z",
    updatedAt: "2026-07-24T16:31:00Z",
    ...overrides,
  };
}

const RUNS = [
  historyItem({ id: "run-9", executionStatus: "running" }),
  historyItem({
    id: "run-8",
    definitionRevision: 4,
    placementKind: "repository",
    executionStatus: "completed",
    createdAt: "2026-07-24T11:02:00Z",
  }),
  historyItem({
    id: "run-7",
    definitionRevision: 3,
    executionStatus: "failed",
    createdAt: "2026-07-23T18:44:00Z",
  }),
  historyItem({
    id: "run-6",
    definitionRevision: 3,
    placementKind: "repository",
    deliveryStatus: "delivery_cancelled",
    desiredState: "cancelled",
    executionStatus: "cancelled",
    createdAt: "2026-07-23T09:15:00Z",
  }),
  historyItem({
    id: "run-5",
    definitionRevision: 2,
    deliveryStatus: "prepared",
    executionStatus: null,
    freshness: "pending",
    createdAt: "2026-07-22T14:38:00Z",
  }),
];

export const RecentRuns = () => (
  <div className="w-full max-w-3xl">
    <WorkflowRunList runs={RUNS} onSelect={() => undefined} />
  </div>
);

export const WithLoadMore = () => (
  <div className="w-full max-w-3xl">
    <WorkflowRunList
      runs={RUNS.slice(0, 3)}
      hasMore
      onSelect={() => undefined}
      onLoadMore={() => undefined}
    />
  </div>
);

export const NoRunsYet = () => (
  <div className="w-full max-w-3xl">
    <WorkflowRunList runs={[]} onSelect={() => undefined} />
  </div>
);

export const LoadFailed = () => (
  <div className="w-full max-w-3xl">
    <WorkflowRunList
      runs={[]}
      error="Recent run history could not be loaded."
      onSelect={() => undefined}
      onRetry={() => undefined}
    />
  </div>
);
