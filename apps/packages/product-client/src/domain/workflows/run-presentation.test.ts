import { describe, expect, it } from "vitest";
import type { ManagedWorkflowInvocationResponse } from "@proliferate/cloud-sdk";
import {
  safeWorkflowFailureCopy,
  workflowHistoryItemPresentation,
  workflowRunPresentation,
  workflowRunTelemetryView,
} from "./run-presentation";

function run(overrides: {
  delivery?: ManagedWorkflowInvocationResponse["managedExecution"]["deliveryStatus"];
  desired?: ManagedWorkflowInvocationResponse["managedExecution"]["desiredState"];
  execution?: NonNullable<ManagedWorkflowInvocationResponse["managedExecution"]["execution"]>["status"] | null;
  freshness?: ManagedWorkflowInvocationResponse["managedExecution"]["freshness"]["status"];
  observedAt?: string | null;
  open?: boolean;
  cancelRequestedAt?: string | null;
} = {}): ManagedWorkflowInvocationResponse {
  return {
    id: "run-1",
    schemaVersion: 1,
    workflowDefinitionId: "workflow-1",
    definitionRevision: 1,
    title: "Triage",
    description: "",
    definition: {
      inputs: [{ name: "ticket", type: "string", required: true }],
      stages: [{
        harnessConfig: {
          agentKind: "claude",
          modelSelection: { kind: "targetDefault" },
          permissionPolicy: "workflowDefault",
          effort: null,
        },
        steps: [{ kind: "agent.prompt", prompt: "Investigate {{inputs.ticket}}" }],
      }],
    },
    arguments: { ticket: "PROL-123" },
    placement: { kind: "scratch" },
    target: { kind: "managedCloud" },
    createdAt: "2026-07-16T00:00:00Z",
    managedExecution: {
      deliveryStatus: overrides.delivery ?? "queued",
      deliveryCheckpoint: "target_plan_frozen",
      desiredState: overrides.desired ?? "active",
      execution: overrides.execution === null || overrides.execution === undefined
        ? null
        : {
          status: overrides.execution,
          stateVersion: 2,
          cancelRequestedAt: overrides.cancelRequestedAt ?? null,
          failureCode: null,
          interruptionCode: overrides.execution === "interrupted" ? "runtime_restarted" : null,
          stopReason: null,
          startedAt: null,
          finishedAt: null,
          steps: [],
        },
      freshness: {
        status: overrides.freshness ?? "pending",
        latestObservedAt: overrides.observedAt ?? null,
      },
      correlations: {
        cloudWorkspaceId: overrides.open ? "cloud-1" : null,
        anyharnessWorkspaceId: overrides.open ? "runtime-1" : null,
        sessionId: overrides.open ? "session-1" : null,
        promptId: null,
        turnId: null,
      },
      openTarget: overrides.open ? {
        cloudWorkspaceId: "cloud-1",
        anyharnessWorkspaceId: "runtime-1",
        sessionId: "session-1",
      } : null,
      deliveryErrorCode: null,
      observationErrorCode: null,
      acceptedAt: null,
      updatedAt: "2026-07-16T00:00:00Z",
    },
  } as ManagedWorkflowInvocationResponse;
}

describe("workflow run presentation", () => {
  it("covers the complete delivery, desired, execution, and freshness matrix", () => {
    const deliveries = ["prepared", "queued", "delivering", "accepted", "delivery_failed", "delivery_cancelled"] as const;
    const desiredStates = ["active", "cancelled"] as const;
    const executions = [null, "accepted", "running", "completed", "failed", "cancelled", "interrupted"] as const;
    const freshnessStates = ["pending", "live", "stale", "unreachable", "target_lost"] as const;
    let combinations = 0;

    for (const delivery of deliveries) {
      for (const desired of desiredStates) {
        for (const execution of executions) {
          for (const freshness of freshnessStates) {
            const view = workflowRunPresentation(run({ delivery, desired, execution, freshness }));
            expect(view.delivery.label).toBeTruthy();
            expect(view.desired.label).toBeTruthy();
            expect(view.execution.label).toBeTruthy();
            expect(view.freshness.label).toBeTruthy();
            expect(view.primary.label).toBeTruthy();
            if (freshness === "target_lost") {
              expect(view.canCancel).toBe(false);
              expect(view.shouldPoll).toBe(false);
            }
            if (execution && ["completed", "failed", "cancelled", "interrupted"].includes(execution)) {
              expect(view.shouldPoll).toBe(false);
            }
            if (delivery === "delivery_failed" || delivery === "delivery_cancelled") {
              expect(view.shouldPoll).toBe(false);
            }
            combinations += 1;
          }
        }
      }
    }

    expect(combinations).toBe(420);
  });

  it.each([
    ["prepared", "Prepared"],
    ["queued", "Queued"],
    ["delivering", "Delivering"],
    ["accepted", "Accepted"],
    ["delivery_failed", "Delivery failed"],
    ["delivery_cancelled", "Delivery cancelled"],
  ] as const)("retains delivery status %s with authored label", (delivery, label) => {
    expect(workflowRunPresentation(run({ delivery })).delivery.label).toBe(label);
  });

  it.each([
    ["accepted", "Accepted"],
    ["running", "Running"],
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
    ["interrupted", "Interrupted"],
  ] as const)("maps execution %s without collapsing dimensions", (execution, label) => {
    expect(workflowRunPresentation(run({ execution })).execution.label).toBe(label);
  });

  it.each(["pending", "live", "stale", "unreachable", "target_lost"] as const)(
    "preserves freshness %s",
    (freshness) => expect(workflowRunPresentation(run({ freshness })).freshness.label).toBeTruthy(),
  );

  it("shows pending cancellation instead of a false terminal state", () => {
    const view = workflowRunPresentation(run({
      desired: "cancelled",
      execution: "running",
      cancelRequestedAt: "2026-07-16T00:01:00Z",
    }));
    expect(view.primary.label).toBe("Cancellation requested");
    expect(view.canCancel).toBe(false);
    expect(view.shouldPoll).toBe(true);
  });

  it("ends cancellation-pending presentation when delivery is durably cancelled", () => {
    const cancelled = run({ delivery: "delivery_cancelled", desired: "cancelled" });
    expect(workflowRunPresentation(cancelled).primary.label).toBe("Delivery cancelled");
    expect(workflowHistoryItemPresentation({
      id: cancelled.id,
      workflowDefinitionId: cancelled.workflowDefinitionId,
      definitionRevision: cancelled.definitionRevision,
      title: cancelled.title,
      placementKind: cancelled.placement.kind,
      targetKind: cancelled.target.kind,
      deliveryStatus: cancelled.managedExecution.deliveryStatus,
      desiredState: cancelled.managedExecution.desiredState,
      executionStatus: null,
      freshness: cancelled.managedExecution.freshness.status,
      latestObservedAt: null,
      cloudWorkspaceId: null,
      sessionId: null,
      createdAt: cancelled.createdAt,
      updatedAt: cancelled.managedExecution.updatedAt,
    }).label).toBe("Delivery cancelled");
  });

  it("distinguishes never-observed unreachable from retained last state", () => {
    expect(workflowRunPresentation(run({ freshness: "unreachable" })).notice)
      .toBe("Runtime unreachable; no execution observation yet.");
    expect(workflowRunPresentation(run({
      freshness: "unreachable",
      observedAt: "2026-07-16T00:02:00Z",
      execution: "running",
    })).notice).toContain("Last observed");
  });

  it("absorbs target loss, disables actions, and stops polling", () => {
    const view = workflowRunPresentation(run({
      freshness: "target_lost",
      desired: "cancelled",
      execution: "running",
      open: true,
    }));
    expect(view.primary.label).toBe("Target lost after cancellation request");
    expect(view.canCancel).toBe(false);
    expect(view.canOpenSession).toBe(true);
    expect(view.shouldPoll).toBe(false);
  });

  it("preserves the cancellation-before-target-loss truth in history", () => {
    const cancelled = run({ desired: "cancelled", freshness: "target_lost", execution: "running" });
    expect(workflowHistoryItemPresentation({
      id: cancelled.id,
      workflowDefinitionId: cancelled.workflowDefinitionId,
      definitionRevision: cancelled.definitionRevision,
      title: cancelled.title,
      placementKind: cancelled.placement.kind,
      targetKind: cancelled.target.kind,
      deliveryStatus: cancelled.managedExecution.deliveryStatus,
      desiredState: cancelled.managedExecution.desiredState,
      executionStatus: "running",
      freshness: "target_lost",
      latestObservedAt: cancelled.managedExecution.freshness.latestObservedAt,
      cloudWorkspaceId: null,
      sessionId: null,
      createdAt: cancelled.createdAt,
      updatedAt: cancelled.managedExecution.updatedAt,
    }).label).toBe("Target lost after cancellation request");
  });

  it("uses authored interrupted and stale status copy", () => {
    expect(workflowRunPresentation(run({ execution: "interrupted", freshness: "live" })).notice)
      .toBe("The runtime restarted and interrupted this run; it was not replayed.");
    expect(workflowRunPresentation(run({ freshness: "stale", observedAt: "2026-07-16T00:02:00Z" })).notice)
      .toContain("Last observed");
  });

  it("allows exact session opening for terminal runs while keeping polling stopped", () => {
    const view = workflowRunPresentation(run({
      delivery: "accepted",
      execution: "completed",
      freshness: "live",
      open: true,
    }));
    expect(view.canOpenSession).toBe(true);
    expect(view.shouldPoll).toBe(false);
  });

  it("maps stable codes and never reflects raw upstream text", () => {
    expect(safeWorkflowFailureCopy("session_create_failed"))
      .toBe("The workflow session could not be created.");
    expect(safeWorkflowFailureCopy("provider said secret=abc"))
      .toBe("The workflow could not be completed. Refresh for the latest safe status.");
  });

  it("excludes frozen argument values from the telemetry projection", () => {
    const value = workflowRunTelemetryView(run());
    expect(value).not.toHaveProperty("arguments");
    expect(JSON.stringify(value)).not.toContain("PROL-123");
  });
});
