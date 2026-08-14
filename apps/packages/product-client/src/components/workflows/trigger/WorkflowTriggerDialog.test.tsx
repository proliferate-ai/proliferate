// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WorkflowDefinitionRecordV2 } from "@proliferate/cloud-sdk";
import { WorkflowTriggerDialog } from "#product/components/workflows/trigger/WorkflowTriggerDialog";

const triggerActions = vi.hoisted(() => ({
  triggerRun: vi.fn(async () => null),
  triggering: false,
  error: null as string | null,
}));

const repositoriesQuery = vi.hoisted(() => ({
  data: {
    repositories: [
      { id: "repo-1", gitOwner: "proliferate-ai", gitRepoName: "proliferate" },
    ],
  },
  isLoading: false,
  isError: false,
}));

vi.mock("#product/hooks/workflows/workflows/use-workflow-trigger-actions", () => ({
  useWorkflowTriggerActions: () => triggerActions,
}));

vi.mock("#product/hooks/access/cloud/workflows/use-workflow-trigger-access", () => ({
  useWorkflowTriggerRepositoriesAccess: () => repositoriesQuery,
}));

// Radix Dialog (ModalShell) touches DOM APIs jsdom doesn't implement.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  triggerActions.triggerRun.mockClear();
  triggerActions.triggering = false;
  triggerActions.error = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkflowTriggerDialog", () => {
  it("gates Confirm on required inputs only", () => {
    renderDialog();

    const confirm = () => screen.getByRole("button", { name: "Start run" });
    expect(confirm()).toHaveProperty("disabled", true);

    // Negative control: the optional input stays empty for the whole test, so
    // an enabled Confirm proves only the required one gates.
    fireEvent.change(screen.getByLabelText("issue"), { target: { value: "PRO-174" } });
    expect(screen.getByLabelText("notes")).toHaveProperty("value", "");
    expect(confirm()).toHaveProperty("disabled", false);

    fireEvent.change(screen.getByLabelText("issue"), { target: { value: "   " } });
    expect(confirm()).toHaveProperty("disabled", true);
  });

  it("defaults placement to a new worktree", () => {
    renderDialog();

    expect(screen.getByRole("radio", { name: "New worktree" }).getAttribute("aria-checked"))
      .toBe("true");
    expect(screen.getByRole("radio", { name: "Repo root" }).getAttribute("aria-checked"))
      .toBe("false");
  });

  it("submits the definition id, supplied arguments and placement", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("issue"), { target: { value: " PRO-174 " } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    expect(triggerActions.triggerRun).toHaveBeenCalledWith({
      workflowDefinitionId: "wf-1",
      arguments: { issue: "PRO-174" },
      placement: { repoConfigId: "repo-1", mode: "worktree" },
    });
  });

  it("carries the chosen repository and repo-root placement into the trigger", () => {
    renderDialog({
      ...definitionRecord(),
      defaultRepoConfigId: null,
    });

    fireEvent.change(screen.getByLabelText("issue"), { target: { value: "PRO-174" } });
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "repo-1" } });
    fireEvent.click(screen.getByRole("radio", { name: "Repo root" }));
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    expect(triggerActions.triggerRun).toHaveBeenCalledWith({
      workflowDefinitionId: "wf-1",
      arguments: { issue: "PRO-174" },
      placement: { repoConfigId: "repo-1", mode: "repo_root" },
    });
  });

  it("renders the trigger error inline", () => {
    triggerActions.error = "The workflow request could not be completed.";
    renderDialog();

    expect(screen.getByRole("alert").textContent)
      .toContain("The workflow request could not be completed.");
  });
});

function definitionRecord(): WorkflowDefinitionRecordV2 {
  return {
    id: "wf-1",
    userId: "user-1",
    title: "Issue triage",
    description: "",
    schemaVersion: 2,
    revision: 3,
    defaultRepoConfigId: "repo-1",
    definition: {
      schemaVersion: 2,
      nodes: [{
        id: "node-1",
        type: "agent",
        title: "Diagnose",
        prompt: "Investigate @input:issue",
      }],
      edges: [],
      inputs: [
        { name: "issue", description: "Issue key to triage", required: true },
        { name: "notes", description: "", required: false },
      ],
      docTemplates: [],
    },
    createdAt: "2026-08-14T12:00:00Z",
    updatedAt: "2026-08-14T12:00:00Z",
    deletedAt: null,
  };
}

function renderDialog(record: WorkflowDefinitionRecordV2 = definitionRecord()) {
  const onOpenChange = vi.fn();
  const onLaunched = vi.fn();
  render(
    <WorkflowTriggerDialog
      definitionRecord={record}
      open
      onOpenChange={onOpenChange}
      onLaunched={onLaunched}
      authCacheScope="user-1"
    />,
  );
  return { onOpenChange, onLaunched };
}
