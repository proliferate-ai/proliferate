// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RepoRoot } from "@anyharness/sdk";
import type { WorkflowDefinitionRecordV2 } from "@proliferate/cloud-sdk";
import { WorkflowTriggerDialog } from "#product/components/workflows/trigger/WorkflowTriggerDialog";

const triggerActions = vi.hoisted(() => ({
  triggerRun: vi.fn(async () => null),
  triggering: false,
  error: null as string | null,
}));

// Runtime repo roots, not cloud repo configs: the runtime resolves
// `placement.repoConfigId` in its own id space.
const repoRootsQuery = vi.hoisted(() => ({
  data: [
    {
      id: "root-1",
      kind: "external" as const,
      path: "/Users/dev/code/proliferate",
      displayName: "proliferate",
      createdAt: "2026-08-14T12:00:00Z",
      updatedAt: "2026-08-14T12:00:00Z",
    },
    {
      id: "root-2",
      kind: "managed" as const,
      path: "/Users/dev/code/sidecar",
      createdAt: "2026-08-14T12:00:00Z",
      updatedAt: "2026-08-14T12:00:00Z",
    },
  ] satisfies RepoRoot[],
  isLoading: false,
  isError: false,
}));

vi.mock("#product/hooks/workflows/workflows/use-workflow-trigger-actions", () => ({
  useWorkflowTriggerActions: () => triggerActions,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useRepoRootsQuery: () => repoRootsQuery,
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
  it("blocks workflow context from telemetry replay", () => {
    renderDialog();

    expect(screen.getByRole("dialog").getAttribute("data-telemetry-block")).toBe("true");
  });

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

  it("submits an argument for every declared input, blank optionals included", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("issue"), { target: { value: " PRO-174 " } });
    // `notes` is left blank on purpose: a prompt that reads `@input:notes`
    // cannot launch unless the argument is present, so it must arrive as "".
    expect(screen.getByLabelText("notes")).toHaveProperty("value", "");
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    expect(triggerActions.triggerRun).toHaveBeenCalledWith({
      workflowDefinitionId: "wf-1",
      arguments: { issue: "PRO-174", notes: "" },
      placement: { repoConfigId: "root-1", mode: "worktree" },
    });
  });

  it("carries the chosen repo root and repo-root placement into the trigger", () => {
    renderDialog({
      ...definitionRecord(),
      defaultRepoConfigId: null,
    });

    fireEvent.change(screen.getByLabelText("issue"), { target: { value: "PRO-174" } });
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "root-2" } });
    fireEvent.click(screen.getByRole("radio", { name: "Repo root" }));
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    expect(triggerActions.triggerRun).toHaveBeenCalledWith({
      workflowDefinitionId: "wf-1",
      arguments: { issue: "PRO-174", notes: "" },
      placement: { repoConfigId: "root-2", mode: "repo_root" },
    });
  });

  it("offers the listed repo roots, falling back to the folder name", () => {
    renderDialog();

    const options = Array.from(
      screen.getByLabelText("Repository").querySelectorAll("option"),
    ).map((option) => [option.getAttribute("value"), option.textContent]);
    expect(options).toEqual([
      ["", "Select a repository"],
      ["root-1", "proliferate"],
      ["root-2", "sidecar"],
    ]);
  });

  it("blocks Start run while the saved repository is not a listed repo root", () => {
    renderDialog({
      ...definitionRecord(),
      defaultRepoConfigId: "repo-config-9",
    });

    fireEvent.change(screen.getByLabelText("issue"), { target: { value: "PRO-174" } });
    expect(screen.getByText("Saved repository unavailable (repo-config-9)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start run" })).toHaveProperty("disabled", true);

    // Negative control: the same form submits once a listed root is picked.
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "root-1" } });
    expect(screen.getByRole("button", { name: "Start run" })).toHaveProperty("disabled", false);
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
    defaultRepoConfigId: "root-1",
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
