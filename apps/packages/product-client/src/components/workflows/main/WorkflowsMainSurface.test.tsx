// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  WorkflowDefinitionListRowV2,
  WorkflowDefinitionRecordV2,
} from "@proliferate/cloud-sdk";
import { WorkflowsMainSurface } from "#product/components/workflows/main/WorkflowsMainSurface";
import type { WorkflowTriggerLaunch } from "#product/hooks/workflows/workflows/use-workflow-trigger-actions";
import { WORKFLOW_STARTER_TEMPLATES_V2 } from "#product/config/workflows/starter-templates";

/** `ProductPageShell`'s sticky title observes its viewport; jsdom has no observer. */
class TestIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

// `WorkflowMainExecutionsGroup` virtualizes its rows (`@tanstack/react-virtual`),
// which measures the scrollport via `offsetHeight` — always 0 in jsdom (no
// layout engine), so the real virtualizer renders zero rows here regardless of
// list length. Stub it to render every row, the same fake the docked file
// tree's own virtualized-list test uses for the identical reason.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 52,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index,
      key: index,
      start: index * 52,
    })),
    measureElement: vi.fn(),
  }),
}));

const mocks = vi.hoisted(() => ({
  listQuery: {
    data: undefined as { workflows: WorkflowDefinitionListRowV2[] } | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  definitionQuery: {
    data: undefined as WorkflowDefinitionRecordV2 | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  deleteWorkflowDefinitionV2: vi.fn(async () => {}),
  deletingWorkflowDefinitionV2: false,
  selectWorkspaceFromSurface: vi.fn(),
  triggerDialog: vi.fn(),
  executions: {
    runs: [] as import("@anyharness/sdk").WorkflowRunV2[],
    loaded: true,
  },
}));

vi.mock("#product/hooks/workflows/facade/use-workflow-executions", () => ({
  useWorkflowExecutions: () => mocks.executions,
}));

vi.mock("#product/hooks/access/cloud/workflows/use-workflow-definitions-v2-access", () => ({
  useWorkflowDefinitionsV2ListAccess: () => mocks.listQuery,
  useWorkflowDefinitionV2Access: () => mocks.definitionQuery,
  useWorkflowDefinitionV2MutationsAccess: () => ({
    deleteWorkflowDefinitionV2: mocks.deleteWorkflowDefinitionV2,
    deletingWorkflowDefinitionV2: mocks.deletingWorkflowDefinitionV2,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-navigation-workflow", () => ({
  useWorkspaceNavigationWorkflow: () => ({
    selectWorkspaceFromSurface: mocks.selectWorkspaceFromSurface,
  }),
}));

vi.mock("#product/components/workflows/trigger/WorkflowTriggerDialog", () => ({
  WorkflowTriggerDialog: (props: {
    definitionRecord: WorkflowDefinitionRecordV2;
    open: boolean;
    onLaunched: (launch: WorkflowTriggerLaunch) => void;
  }) => {
    mocks.triggerDialog(props);
    return <div data-testid="trigger-dialog">{props.definitionRecord.title}</div>;
  },
}));

// ModalShell (Radix Dialog) touches DOM APIs jsdom doesn't implement.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};

  mocks.listQuery.data = undefined;
  mocks.listQuery.isLoading = false;
  mocks.listQuery.isError = false;
  mocks.listQuery.refetch.mockClear();
  mocks.definitionQuery.data = undefined;
  mocks.definitionQuery.isLoading = false;
  mocks.definitionQuery.isError = false;
  mocks.deletingWorkflowDefinitionV2 = false;
  mocks.deleteWorkflowDefinitionV2.mockClear();
  mocks.deleteWorkflowDefinitionV2.mockResolvedValue(undefined);
  mocks.selectWorkspaceFromSurface.mockClear();
  mocks.triggerDialog.mockClear();
  mocks.executions.runs = [];
  mocks.executions.loaded = true;
});

afterEach(() => {
  cleanup();
});

function listRow(overrides: Partial<WorkflowDefinitionListRowV2> = {}): WorkflowDefinitionListRowV2 {
  return {
    id: "wf-1",
    title: "Issue triage",
    description: "Triages new issues against the repo.",
    revision: 4,
    createdAt: "2020-01-01T00:00:00Z",
    updatedAt: "2020-03-05T00:00:00Z",
    schemaVersion: 2,
    ...overrides,
  };
}

function definitionRecord(overrides: Partial<WorkflowDefinitionRecordV2> = {}): WorkflowDefinitionRecordV2 {
  return {
    id: "wf-1",
    userId: "user-1",
    title: "Issue triage",
    description: "Triages new issues against the repo.",
    schemaVersion: 2,
    revision: 4,
    defaultRepoConfigId: null,
    definition: { schemaVersion: 2, nodes: [], edges: [], inputs: [], docTemplates: [] },
    createdAt: "2020-01-01T00:00:00Z",
    updatedAt: "2020-03-05T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("WorkflowsMainSurface", () => {
  it("announces loading without rendering the empty state", () => {
    mocks.listQuery.isLoading = true;
    render(<WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("Loading workflows");
    expect(screen.queryByText("No workflows yet")).toBeNull();
  });

  it("renders the supplied error copy and retries the definitions query", () => {
    mocks.listQuery.isError = true;
    render(<WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByText("Workflows could not be loaded")).toBeTruthy();
    expect(screen.getByText(/Retrying does not lose any saved work/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.listQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it("routes the header menu's blank item and every starter template", async () => {
    mocks.listQuery.data = { workflows: [listRow()] };
    const onNew = vi.fn();
    const user = userEvent.setup();
    render(<WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={onNew} />);

    await user.click(screen.getByRole("button", { name: "New workflow options" }));
    // Exact: the tier-2 definition-lifecycle spec resolves this item by its
    // exact accessible name, so trailing content added here breaks that too.
    await user.click(await screen.findByRole("menuitem", { name: "Blank workflow", exact: true }));
    expect(onNew).toHaveBeenCalledWith(null);

    for (const template of WORKFLOW_STARTER_TEMPLATES_V2) {
      await user.click(screen.getByRole("button", { name: "New workflow options" }));
      await user.click(await screen.findByRole("menuitem", { name: template.title }));
      expect(onNew).toHaveBeenCalledWith(template);
    }
  });

  it("renders a v2 row's title, description and updated-at", () => {
    mocks.listQuery.data = {
      workflows: [
        listRow({ id: "wf-1", title: "Issue triage", description: "Triages new issues against the repo." }),
      ],
    };

    render(
      <WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={vi.fn()} />,
    );

    expect(screen.getByText("Issue triage")).toBeTruthy();
    expect(screen.getByText("Triages new issues against the repo.")).toBeTruthy();
    expect(screen.getByText(/2020/)).toBeTruthy();
    expect(screen.queryByText("Legacy")).toBeNull();
  });

  it("opens the trigger dialog with the clicked row's full record on Run", async () => {
    mocks.listQuery.data = { workflows: [listRow()] };
    mocks.definitionQuery.data = definitionRecord();

    render(
      <WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={vi.fn()} />,
    );

    expect(screen.queryByTestId("trigger-dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run Issue triage" }));

    await waitFor(() => expect(screen.getByTestId("trigger-dialog")).toBeTruthy());
    expect(mocks.triggerDialog).toHaveBeenCalledWith(
      expect.objectContaining({ definitionRecord: definitionRecord(), open: true }),
    );
  });

  it("opens the launched run's workspace with the record the launch carried", async () => {
    mocks.listQuery.data = { workflows: [listRow()] };
    mocks.definitionQuery.data = definitionRecord();

    render(
      <WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run Issue triage" }));
    await waitFor(() => expect(screen.getByTestId("trigger-dialog")).toBeTruthy());

    const launched = mocks.triggerDialog.mock.calls.at(-1)?.[0].onLaunched;
    // The run PUT is what created this workspace, so the collections cache
    // cannot know it: without the record selection fails "Workspace not found."
    launched({ runId: "run-1", workspaceId: "ws-9", workspace: { id: "ws-9" } });

    expect(mocks.selectWorkspaceFromSurface).toHaveBeenCalledWith(
      "ws-9",
      "workflows-main-surface",
      { knownWorkspace: { id: "ws-9" } },
    );
  });

  it("calls onEdit with the definition id", () => {
    mocks.listQuery.data = { workflows: [listRow()] };
    const onEdit = vi.fn();

    render(
      <WorkflowsMainSurface authCacheScope="user-1" onEdit={onEdit} onNew={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Issue triage" }));
    expect(onEdit).toHaveBeenCalledWith("wf-1");
  });

  it("shows all four starter templates and a start-blank path in the empty state", () => {
    mocks.listQuery.data = { workflows: [] };
    const onNew = vi.fn();

    render(
      <WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={onNew} />,
    );

    for (const template of WORKFLOW_STARTER_TEMPLATES_V2) {
      expect(screen.getByText(template.title)).toBeTruthy();
    }
    expect(screen.getAllByRole("button", { name: "Use template" })).toHaveLength(
      WORKFLOW_STARTER_TEMPLATES_V2.length,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Use template" })[0]);
    expect(onNew).toHaveBeenCalledWith(WORKFLOW_STARTER_TEMPLATES_V2[0]);

    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    expect(onNew).toHaveBeenCalledWith(null);
  });

  it("deletes through the access action once the confirm dialog is confirmed", async () => {
    mocks.listQuery.data = { workflows: [listRow({ id: "wf-1", revision: 4 })] };

    render(
      <WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={vi.fn()} />,
    );

    // Radix's dropdown trigger opens on pointerdown, not a synthetic click.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Issue triage actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete..." }));

    expect(screen.getByText("Delete this workflow?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mocks.deleteWorkflowDefinitionV2).toHaveBeenCalledWith({
      workflowDefinitionId: "wf-1",
      expectedRevision: 4,
    }));
  });

  it("does not delete when the confirm dialog is cancelled", async () => {
    mocks.listQuery.data = { workflows: [listRow()] };

    render(
      <WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={vi.fn()} />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Issue triage actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete..." }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Delete this workflow?")).toBeNull();
    expect(mocks.deleteWorkflowDefinitionV2).not.toHaveBeenCalled();
  });
});

function executionRun(
  overrides: Partial<import("@anyharness/sdk").WorkflowRunV2> = {},
): import("@anyharness/sdk").WorkflowRunV2 {
  return {
    id: "run-1",
    invocationId: "inv-1",
    definitionJson: "{}",
    argumentsJson: "{}",
    workspaceId: "ws-1",
    status: "completed",
    currentNodeRowId: null,
    failureCode: null,
    interruptionCode: null,
    createdAt: "2020-03-05T00:00:00Z",
    updatedAt: "2020-03-05T00:01:40Z",
    completedAt: "2020-03-05T00:01:40Z",
    ...overrides,
  };
}

describe("WorkflowsMainSurface executions group", () => {
  it("lists a run under Executions with its state and wall clock, and opens its workspace", () => {
    mocks.listQuery.data = { workflows: [listRow()] };
    mocks.executions.runs = [executionRun()];

    render(
      <WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "Executions" })).toBeTruthy();
    // definitionJson carries no title today, so the row wears the fallback.
    expect(screen.getByText("Workflow run")).toBeTruthy();
    expect(screen.getByText("Succeeded · 1m 40s")).toBeTruthy();

    fireEvent.click(screen.getByText("Workflow run"));
    expect(mocks.selectWorkspaceFromSurface).toHaveBeenCalledWith("ws-1", "workflows-main-surface");
  });

  it("renders no Executions group while the roster is empty or unloaded", () => {
    mocks.listQuery.data = { workflows: [listRow()] };
    mocks.executions.runs = [];

    render(
      <WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={vi.fn()} />,
    );

    expect(screen.queryByText("Executions")).toBeNull();
  });
});

describe("WorkflowsMainSurface filter", () => {
  it("filters every group by what the rows visibly say", () => {
    mocks.listQuery.data = {
      workflows: [
        listRow({ id: "wf-1", title: "Issue triage" }),
        listRow({ id: "wf-2", title: "Release notes" }),
      ],
    };
    mocks.executions.runs = [executionRun()];

    render(
      <WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("Filter workflows"), {
      target: { value: "release" },
    });

    expect(screen.getByText("Release notes")).toBeTruthy();
    expect(screen.queryByText("Issue triage")).toBeNull();
    // "release" matches no run title, so the whole group drops out.
    expect(screen.queryByText("Executions")).toBeNull();
  });

  it("says so when nothing matches the filter", () => {
    mocks.listQuery.data = { workflows: [listRow()] };

    render(
      <WorkflowsMainSurface authCacheScope="user-1" onEdit={vi.fn()} onNew={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("Filter workflows"), {
      target: { value: "zzz" },
    });

    expect(screen.getByText("Nothing matches “zzz”.")).toBeTruthy();
  });
});
