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
  it("gates Confirm on required inputs only", () => {
    renderDialog();

    const confirm = () => screen.getByRole("button", { name: "Start run" });
    expect(confirm()).toHaveProperty("disabled", true);

    // Negative control: the optional input stays empty for the whole test, so
    // an enabled Confirm proves only the required one gates.
    fireEvent.change(screen.getByLabelText("Issue"), { target: { value: "PRO-174" } });
    expect(screen.getByLabelText("Notes")).toHaveProperty("value", "");
    expect(confirm()).toHaveProperty("disabled", false);

    fireEvent.change(screen.getByLabelText("Issue"), { target: { value: "   " } });
    expect(confirm()).toHaveProperty("disabled", true);
  });

  it("shows the authored workflow description under the title", () => {
    renderDialog({ ...definitionRecord(), description: "Triage one issue end to end." });

    expect(screen.getByText("Triage one issue end to end.")).toBeTruthy();
  });

  it("collapses a usable saved repository to a summary until Change is clicked", () => {
    renderDialog();

    // The saved default (root-1) is listed, so the location reads as one line
    // and neither control is rendered.
    expect(screen.getByText(/Runs in/).textContent).toBe("Runs in proliferate · New worktree");
    expect(screen.queryByLabelText("Repository")).toBeNull();
    expect(screen.queryByRole("radio", { name: "New worktree" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    expect(screen.getByLabelText("Repository")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "New worktree" }).getAttribute("aria-checked"))
      .toBe("true");
    expect(screen.getByRole("radio", { name: "Repo root" }).getAttribute("aria-checked"))
      .toBe("false");
  });

  it("submits an argument for every declared input, blank optionals included", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("Issue"), { target: { value: " PRO-174 " } });
    // `notes` is left blank on purpose: a prompt that reads `@input:notes`
    // cannot launch unless the argument is present, so it must arrive as "".
    expect(screen.getByLabelText("Notes")).toHaveProperty("value", "");
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

    // No saved default: the location controls are open from the start.
    fireEvent.change(screen.getByLabelText("Issue"), { target: { value: "PRO-174" } });
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

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
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

    // An unavailable saved default forces the controls open — a summary line
    // could not explain why the run is blocked.
    fireEvent.change(screen.getByLabelText("Issue"), { target: { value: "PRO-174" } });
    expect(screen.getByText("Saved repository unavailable (repo-config-9)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start run" })).toHaveProperty("disabled", true);

    // Negative control: the same form submits once a listed root is picked.
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "root-1" } });
    expect(screen.getByRole("button", { name: "Start run" })).toHaveProperty("disabled", false);
  });

  it("submits on Enter through the native form, honouring the disabled gate", () => {
    renderDialog();
    const form = () => {
      const found = document.getElementById("workflow-trigger-form");
      if (!(found instanceof HTMLFormElement)) {
        throw new Error("trigger form not rendered");
      }
      return found;
    };

    // The footer button lives outside the form and joins it by id — the
    // association implicit submission depends on.
    expect(screen.getByRole("button", { name: "Start run" }).getAttribute("form"))
      .toBe("workflow-trigger-form");

    // Required input missing: the submit handler's own guard must hold even
    // if a submission event gets through.
    fireEvent.submit(form());
    expect(triggerActions.triggerRun).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Issue"), { target: { value: "PRO-174" } });
    fireEvent.submit(form());
    expect(triggerActions.triggerRun).toHaveBeenCalledWith({
      workflowDefinitionId: "wf-1",
      arguments: { issue: "PRO-174", notes: "" },
      placement: { repoConfigId: "root-1", mode: "worktree" },
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
