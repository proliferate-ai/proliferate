// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRun } from "@proliferate/product-domain/workflows/run-presentation";
import { workflowRunPresentation } from "@proliferate/product-domain/workflows/run-presentation";
import { createWorkflowArgumentDraft } from "@proliferate/product-domain/workflows/arguments";
import { WorkflowRunDetail } from "./WorkflowRunDetail";
import { WorkflowRunForm } from "./WorkflowRunForm";

class TestIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

afterEach(cleanup);

const input = { name: "ticket", type: "string" as const, required: true };

describe("Workflow run UI", () => {
  it("keeps a disabled launch visible with authored capability copy", () => {
    render(
      <WorkflowRunForm
        inputs={[input]}
        draft={createWorkflowArgumentDraft([input])}
        issues={[]}
        blockers={[]}
        capabilityEnabled={false}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "Run in Cloud" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByText(/not enabled on this server/u)).toBeTruthy();
    expect(screen.getByText(/existing run history remain available/u)).toBeTruthy();
  });

  it("orders exact eligibility blockers and never submits while ineligible", () => {
    const onSubmit = vi.fn();
    render(
      <WorkflowRunForm
        inputs={[]}
        draft={{}}
        issues={[]}
        blockers={[
          { path: "stages[1]", code: "stage_count_not_supported", message: "One stage only." },
          { path: "stages[0].steps[0].goal", code: "goal_not_supported", message: "Goals are unavailable." },
        ]}
        capabilityEnabled
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const text = screen.getByRole("status").textContent ?? "";
    expect(text.indexOf("stages[0]")).toBeLessThan(text.indexOf("stages[1]"));
    fireEvent.click(screen.getByRole("button", { name: "Run in Cloud" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("explains prompt-referenced optional inputs before submission", () => {
    const optional = { name: "context", type: "string" as const, required: false };
    render(
      <WorkflowRunForm
        inputs={[optional]}
        draft={createWorkflowArgumentDraft([optional])}
        issues={[]}
        blockers={[]}
        requiredForRunInputNames={new Set(["context"])}
        capabilityEnabled
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Required for run")).toBeTruthy();
    expect(screen.getByText(/optional input is used by the prompt/u)).toBeTruthy();
    expect(screen.queryByText("Include")).toBeNull();
    expect((screen.getByLabelText("context") as HTMLInputElement).disabled).toBe(false);
  });

  it("renders frozen inputs collapsed and replay-masked", () => {
    const run = fixtureRun();
    const { container } = render(
      <WorkflowRunDetail
        run={run}
        presentation={workflowRunPresentation(run)}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onStartDelivery={vi.fn()}
        onCancel={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    );

    const details = screen.getByText("Inputs (1)").closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(container.querySelector("[data-telemetry-mask]")?.textContent).toContain("PROL-123");
    expect(screen.queryByRole("button", { name: "Open session" })).toBeNull();
    expect(screen.getByText("Scratch workspace")).toBeTruthy();
  });
});

function fixtureRun(): WorkflowRun {
  return {
    id: "run-1",
    schemaVersion: 1,
    workflowDefinitionId: "workflow-1",
    definitionRevision: 1,
    title: "Triage",
    description: "",
    definition: { inputs: [input], stages: [] },
    arguments: { ticket: "PROL-123" },
    placement: { kind: "scratch" },
    target: { kind: "managedCloud" },
    createdAt: "2026-07-16T00:00:00Z",
    managedExecution: {
      deliveryStatus: "queued",
      deliveryCheckpoint: "target_plan_frozen",
      desiredState: "active",
      execution: null,
      freshness: { status: "pending", latestObservedAt: null },
      correlations: {
        cloudWorkspaceId: null,
        anyharnessWorkspaceId: null,
        sessionId: null,
        promptId: null,
        turnId: null,
      },
      openTarget: null,
      deliveryErrorCode: null,
      observationErrorCode: null,
      acceptedAt: null,
      updatedAt: "2026-07-16T00:00:00Z",
    },
  } as WorkflowRun;
}
