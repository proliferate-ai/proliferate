import type {
  ManagedWorkflowHistoryItem,
  ManagedWorkflowInvocationResponse,
} from "@proliferate/cloud-sdk";

export type WorkflowRun = ManagedWorkflowInvocationResponse;
export type WorkflowRunHistoryItem = ManagedWorkflowHistoryItem;

export type WorkflowRunTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface WorkflowRunStatusView {
  label: string;
  tone: WorkflowRunTone;
}

export interface WorkflowRunPresentation {
  primary: WorkflowRunStatusView;
  delivery: WorkflowRunStatusView;
  desired: WorkflowRunStatusView;
  execution: WorkflowRunStatusView;
  freshness: WorkflowRunStatusView;
  notice: string | null;
  failure: string | null;
  canStartDelivery: boolean;
  canCancel: boolean;
  canOpenSession: boolean;
  shouldPoll: boolean;
}

const TERMINAL_EXECUTION = new Set(["completed", "failed", "cancelled", "interrupted"]);

export function workflowRunPresentation(
  run: ManagedWorkflowInvocationResponse,
): WorkflowRunPresentation {
  const managed = run.managedExecution;
  const execution = managed.execution;
  const targetLost = managed.freshness.status === "target_lost";
  const cancellationPending = isCancellationPending({
    desiredState: managed.desiredState,
    deliveryStatus: managed.deliveryStatus,
    executionStatus: execution?.status ?? null,
  });
  const delivery = deliveryPresentation(managed.deliveryStatus);
  const desired = managed.desiredState === "cancelled"
    ? { label: "Cancellation requested", tone: "warning" as const }
    : { label: "Active", tone: "neutral" as const };
  const executionView = execution
    ? executionPresentation(execution.status)
    : { label: "No runtime result", tone: "neutral" as const };
  const freshness = freshnessPresentation(managed.freshness.status);

  const primary = targetLost
    ? { label: cancellationPending ? "Target lost after cancellation request" : "Target lost", tone: "warning" as const }
    : cancellationPending
      ? { label: "Cancellation requested", tone: "warning" as const }
      : execution
        ? executionView
        : delivery;

  return {
    primary,
    delivery,
    desired,
    execution: executionView,
    freshness,
    notice: workflowRunNotice(run),
    failure: safeWorkflowFailureCopy(
      execution?.failureCode
      ?? managed.deliveryErrorCode
      ?? managed.observationErrorCode,
    ),
    canStartDelivery: managed.deliveryStatus === "prepared"
      && managed.desiredState === "active"
      && !targetLost,
    canCancel: managed.desiredState === "active"
      && !targetLost
      && managed.deliveryStatus !== "delivery_failed"
      && managed.deliveryStatus !== "delivery_cancelled"
      && (!execution || !TERMINAL_EXECUTION.has(execution.status)),
    canOpenSession: managed.openTarget !== null,
    shouldPoll: shouldPollWorkflowRun(run),
  };
}

export function shouldPollWorkflowRun(run: ManagedWorkflowInvocationResponse): boolean {
  const managed = run.managedExecution;
  if (managed.freshness.status === "target_lost") return false;
  const execution = managed.execution;
  if (execution && TERMINAL_EXECUTION.has(execution.status)) return false;
  if (["delivery_failed", "delivery_cancelled"].includes(managed.deliveryStatus)) return false;
  return true;
}

export function workflowHistoryItemPresentation(
  item: ManagedWorkflowHistoryItem,
): WorkflowRunStatusView {
  if (item.freshness === "target_lost") {
    return {
      label: item.desiredState === "cancelled"
        ? "Target lost after cancellation request"
        : "Target lost",
      tone: "warning",
    };
  }
  if (isCancellationPending(item)) {
    return { label: "Cancellation requested", tone: "warning" };
  }
  return item.executionStatus
    ? executionPresentation(item.executionStatus)
    : deliveryPresentation(item.deliveryStatus);
}

function isCancellationPending(value: {
  desiredState: ManagedWorkflowInvocationResponse["managedExecution"]["desiredState"];
  deliveryStatus: ManagedWorkflowInvocationResponse["managedExecution"]["deliveryStatus"];
  executionStatus: ManagedWorkflowHistoryItem["executionStatus"];
}): boolean {
  return value.desiredState === "cancelled"
    && value.deliveryStatus !== "delivery_cancelled"
    && (!value.executionStatus || !TERMINAL_EXECUTION.has(value.executionStatus));
}

export function safeWorkflowFailureCopy(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = code.toLowerCase();
  const known: Record<string, string> = {
    workflow_target_lost: "The managed runtime was replaced, so the final outcome is unknown.",
    workflow_run_target_unresolvable: "The selected agent or model is not available on the managed runtime.",
    workspace_unavailable: "The managed workspace is unavailable.",
    session_create_failed: "The workflow session could not be created.",
    session_config_apply_failed: "The workflow session could not apply its required configuration.",
    prompt_dispatch_failed: "The workflow prompt could not be accepted by the session.",
    runtime_restarted: "The runtime restarted and interrupted this run; it was not replayed.",
  };
  return known[normalized] ?? "The workflow could not be completed. Refresh for the latest safe status.";
}

export function workflowRunTelemetryView(run: ManagedWorkflowInvocationResponse) {
  return {
    invocationId: run.id,
    workflowDefinitionId: run.workflowDefinitionId,
    deliveryStatus: run.managedExecution.deliveryStatus,
    desiredState: run.managedExecution.desiredState,
    executionStatus: run.managedExecution.execution?.status ?? null,
    freshness: run.managedExecution.freshness.status,
    placementKind: run.placement.kind,
  };
}

function workflowRunNotice(run: ManagedWorkflowInvocationResponse): string | null {
  const managed = run.managedExecution;
  const observed = managed.freshness.latestObservedAt;
  switch (managed.freshness.status) {
    case "unreachable":
      return observed
        ? `Runtime unreachable. Last observed ${formatDateTime(observed)}.`
        : "Runtime unreachable; no execution observation yet.";
    case "stale":
      return observed ? `Status may be stale. Last observed ${formatDateTime(observed)}.` : "Status may be stale.";
    case "target_lost":
      return managed.desiredState === "cancelled"
        ? "Target lost after cancellation request. The final outcome is unknown."
        : "The managed runtime was replaced. The final outcome is unknown.";
    default:
      if (managed.execution?.status === "interrupted") {
        return "The runtime restarted and interrupted this run; it was not replayed.";
      }
      return null;
  }
}

function deliveryPresentation(status: ManagedWorkflowInvocationResponse["managedExecution"]["deliveryStatus"]): WorkflowRunStatusView {
  const labels = {
    prepared: ["Prepared", "neutral"],
    queued: ["Queued", "info"],
    delivering: ["Delivering", "info"],
    accepted: ["Accepted", "info"],
    delivery_failed: ["Delivery failed", "danger"],
    delivery_cancelled: ["Delivery cancelled", "neutral"],
  } as const;
  const [label, tone] = labels[status];
  return { label, tone };
}

function executionPresentation(status: NonNullable<ManagedWorkflowInvocationResponse["managedExecution"]["execution"]>["status"]): WorkflowRunStatusView {
  const labels = {
    accepted: ["Accepted", "info"],
    running: ["Running", "info"],
    completed: ["Completed", "success"],
    failed: ["Failed", "danger"],
    cancelled: ["Cancelled", "neutral"],
    interrupted: ["Interrupted", "warning"],
  } as const;
  const [label, tone] = labels[status];
  return { label, tone };
}

function freshnessPresentation(status: ManagedWorkflowInvocationResponse["managedExecution"]["freshness"]["status"]): WorkflowRunStatusView {
  const labels = {
    pending: ["Pending", "neutral"],
    live: ["Live", "success"],
    stale: ["Stale", "warning"],
    unreachable: ["Runtime unreachable", "warning"],
    target_lost: ["Target lost", "warning"],
  } as const;
  const [label, tone] = labels[status];
  return { label, tone };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
