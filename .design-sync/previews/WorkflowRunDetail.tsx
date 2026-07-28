import type { ReactNode } from "react";
import { WorkflowRunDetail } from "@proliferate/ui";

/**
 * `WorkflowRunDetail` renders inside `ProductPageShell` — a `h-full flex-1
 * overflow-auto` scroll viewport that collapses to nothing without a bounded
 * parent, so each cell supplies the sized pane the app route gives it. The
 * `presentation` prop is the pure view the domain's `workflowRunPresentation`
 * derives; the objects below are the shapes it actually produces.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border"
      style={{ height: 620 }}
    >
      {children}
    </div>
  );
}

function run(overrides) {
  return {
    id: "wfr_01J9Q7ZK4M2C8VYN3T",
    schemaVersion: 1,
    workflowDefinitionId: "wf-triage",
    definitionRevision: 4,
    title: "Issue triage",
    description: "",
    definition: { inputs: [], stages: [] },
    arguments: {
      ticket: "PROL-1284",
      repository: "proliferate/anyharness",
      includeLogs: true,
    },
    placement: { kind: "scratch" },
    target: { kind: "managedCloud" },
    createdAt: "2026-07-24T16:20:00Z",
    ...overrides,
    managedExecution: {
      deliveryStatus: "accepted",
      deliveryCheckpoint: "target_plan_frozen",
      desiredState: "active",
      execution: null,
      freshness: { status: "fresh", latestObservedAt: "2026-07-24T16:31:00Z" },
      correlations: {
        cloudWorkspaceId: "cw-8813",
        anyharnessWorkspaceId: "ws-2210",
        sessionId: "sess-4471",
        promptId: "p-1",
        turnId: "t-1",
      },
      openTarget: null,
      deliveryErrorCode: null,
      observationErrorCode: null,
      acceptedAt: "2026-07-24T16:21:10Z",
      updatedAt: "2026-07-24T16:31:00Z",
      ...(overrides?.managedExecution ?? {}),
    },
  };
}

const RUNNING = run({
  managedExecution: {
    execution: {
      status: "running",
      steps: [
        { index: 0, status: "completed" },
        { index: 1, status: "running" },
      ],
    },
    openTarget: { kind: "session", sessionId: "sess-4471" },
  },
});

const PREPARED = run({
  managedExecution: {
    deliveryStatus: "prepared",
    deliveryCheckpoint: "invocation_persisted",
    freshness: { status: "pending", latestObservedAt: null },
    acceptedAt: null,
  },
});

const FAILED = run({
  placement: { kind: "repository" },
  managedExecution: {
    execution: { status: "failed", steps: [{ index: 0, status: "failed" }] },
    deliveryErrorCode: null,
  },
});

const RUNNING_PRESENTATION = {
  primary: { label: "Running", tone: "info" },
  delivery: { label: "Accepted", tone: "success" },
  desired: { label: "Active", tone: "neutral" },
  execution: { label: "Running", tone: "info" },
  freshness: { label: "Fresh", tone: "success" },
  notice: null,
  failure: null,
  canStartDelivery: false,
  canCancel: true,
  canOpenSession: true,
  shouldPoll: true,
};

const PREPARED_PRESENTATION = {
  primary: { label: "Prepared", tone: "neutral" },
  delivery: { label: "Prepared", tone: "neutral" },
  desired: { label: "Active", tone: "neutral" },
  execution: { label: "No runtime result", tone: "neutral" },
  freshness: { label: "Awaiting first observation", tone: "neutral" },
  // `notice` is deliberately null: the component renders it as `text-warning`,
  // and in this dark theme `--color-warning` is an alpha FILL (15%) rather than
  // an ink token, so the band photographs blank. See .design-sync/learnings/I.md.
  notice: null,
  failure: null,
  canStartDelivery: true,
  canCancel: true,
  canOpenSession: false,
  shouldPoll: true,
};

const FAILED_PRESENTATION = {
  primary: { label: "Failed", tone: "danger" },
  delivery: { label: "Accepted", tone: "success" },
  desired: { label: "Active", tone: "neutral" },
  execution: { label: "Failed", tone: "danger" },
  freshness: { label: "Fresh", tone: "success" },
  notice: null,
  failure: "The agent session ended before the first prompt step completed.",
  canStartDelivery: false,
  canCancel: false,
  canOpenSession: false,
  shouldPoll: false,
};

const noop = () => undefined;

const HANDLERS = {
  onBack: noop,
  onRefresh: noop,
  onStartDelivery: noop,
  onCancel: noop,
  onOpenSession: noop,
};

export const Running = () => (
  <Frame>
    <WorkflowRunDetail run={RUNNING} presentation={RUNNING_PRESENTATION} {...HANDLERS} />
  </Frame>
);

export const PreparedForDelivery = () => (
  <Frame>
    <WorkflowRunDetail run={PREPARED} presentation={PREPARED_PRESENTATION} {...HANDLERS} />
  </Frame>
);

export const FailedRun = () => (
  <Frame>
    <WorkflowRunDetail run={FAILED} presentation={FAILED_PRESENTATION} {...HANDLERS} />
  </Frame>
);

export const DeliveryUnavailable = () => (
  <Frame>
    <WorkflowRunDetail
      run={PREPARED}
      presentation={PREPARED_PRESENTATION}
      deliveryCapabilityEnabled={false}
      actionError="Managed delivery returned 503. The prepared run is unchanged."
      {...HANDLERS}
    />
  </Frame>
);
