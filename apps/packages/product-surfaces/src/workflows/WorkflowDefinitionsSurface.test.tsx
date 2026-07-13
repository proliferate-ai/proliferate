// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { WorkflowDefinitionsSurface } from "./WorkflowDefinitionsSurface";

class TestIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
vi.stubGlobal("ResizeObserver", TestResizeObserver);

const cloud = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  refetchDetail: vi.fn(),
  useWorkflowDefinitions: vi.fn(),
  useWorkflowDefinition: vi.fn(),
  useCloudAgentCatalog: vi.fn(),
  useRepositories: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useWorkflowDefinitions: cloud.useWorkflowDefinitions,
  useWorkflowDefinition: cloud.useWorkflowDefinition,
  useCloudAgentCatalog: cloud.useCloudAgentCatalog,
  useRepositories: cloud.useRepositories,
  useWorkflowDefinitionActions: () => ({
    createWorkflowDefinition: cloud.create,
    creatingWorkflowDefinition: false,
    updateWorkflowDefinition: cloud.update,
    updatingWorkflowDefinition: false,
    deleteWorkflowDefinition: cloud.remove,
    deletingWorkflowDefinition: false,
  }),
}));

const catalog = {
  schemaVersion: 2 as const,
  catalogVersion: "probe-7",
  defaultAgentKind: "claude",
  generatedAt: "2026-07-12T00:00:00Z",
  agents: [{
    kind: "claude" as const,
    displayName: "Claude",
    harness: { agentProcess: { version: "1" } },
    authContexts: [],
    provenance: { probedAt: "2026-07-12T00:00:00Z", runs: [] },
    session: {
      supportsGoals: true,
      controls: [{
        key: "effort",
        values: ["low", "high"],
        mapping: { liveConfigId: "effort" },
      }],
      defaults: {},
      observedDefaults: {},
      models: [{
        id: "default",
        displayName: "Default",
        aliases: [],
        availability: { anyOf: [] },
        defaultVisible: true,
        status: "active" as const,
        controls: { effort: { values: ["low", "high"] } },
      }],
    },
  }],
};

const persisted = {
  id: "workflow-1",
  userId: "user-1",
  title: "Saved title",
  description: "",
  schemaVersion: 1 as const,
  revision: 2,
  validatedCatalogVersion: "probe-7",
  defaultRepoConfigId: null,
  inputs: [],
  stages: [{
    harnessConfig: { agentKind: "claude", modelId: null, effort: null },
    steps: [{ kind: "agent.prompt" as const, prompt: "Investigate", goal: null }],
  }],
  createdAt: "2026-07-12T00:00:00Z",
  updatedAt: "2026-07-12T00:00:00Z",
  deletedAt: null,
};

describe("WorkflowDefinitionsSurface", () => {
  beforeEach(() => {
    cloud.useWorkflowDefinitions.mockReturnValue({
      data: { workflows: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    cloud.useWorkflowDefinition.mockReturnValue({
      data: persisted,
      isLoading: false,
      isError: false,
      refetch: cloud.refetchDetail,
    });
    cloud.useCloudAgentCatalog.mockReturnValue({
      data: catalog,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    cloud.useRepositories.mockReturnValue({
      data: { repositories: [] },
      isLoading: false,
      isError: false,
    });
    cloud.create.mockResolvedValue(persisted);
    cloud.update.mockResolvedValue(persisted);
    cloud.remove.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("creates a personal no-repository definition with runtime defaults", async () => {
    const onSelectWorkflow = vi.fn();
    render(
      <WorkflowDefinitionsSurface
        authCacheScope="user-1"
        onSelectWorkflow={onSelectWorkflow}
        onBackToList={vi.fn()}
      />,
    );

    expect(cloud.useWorkflowDefinitions).toHaveBeenCalledWith("user-1", true);
    expect(cloud.useRepositories).toHaveBeenCalledWith(true, "user-1");

    fireEvent.click(screen.getAllByRole("button", { name: "New workflow" })[0]!);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Triage" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Investigate" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(cloud.create).toHaveBeenCalledTimes(1));
    expect(cloud.create).toHaveBeenCalledWith(expect.objectContaining({
      title: "Triage",
      description: "",
      defaultRepoConfigId: null,
      stages: [expect.objectContaining({
        harnessConfig: {
          agentKind: "claude",
          modelId: null,
          effort: null,
        },
      })],
    }));
    expect(onSelectWorkflow).toHaveBeenCalledWith("workflow-1");
  });

  it("preserves the create draft when the live catalog refreshes", () => {
    const props = {
      authCacheScope: "user-1",
      onSelectWorkflow: vi.fn(),
      onBackToList: vi.fn(),
    };
    const { rerender } = render(<WorkflowDefinitionsSurface {...props} />);

    fireEvent.click(screen.getAllByRole("button", { name: "New workflow" })[0]!);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Keep my draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add input" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "ticket" } });
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Investigate {{inputs.ticket}}" },
    });

    cloud.useCloudAgentCatalog.mockReturnValue({
      data: {
        ...catalog,
        catalogVersion: "probe-8",
        agents: catalog.agents.map((agent) => ({
          ...agent,
          displayName: "Claude refreshed",
        })),
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    rerender(<WorkflowDefinitionsSurface {...props} />);

    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Keep my draft");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("ticket");
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value)
      .toBe("Investigate {{inputs.ticket}}");
    const harness = screen.getByLabelText("Harness") as HTMLSelectElement;
    expect(harness.options[harness.selectedIndex]?.text).toBe("Claude refreshed");
  });

  it("preserves the local draft after an optimistic revision conflict", async () => {
    cloud.update.mockRejectedValue(
      new ProliferateClientError("stale revision", 409, "workflow_revision_conflict"),
    );
    render(
      <WorkflowDefinitionsSurface
        authCacheScope="user-1"
        selectedWorkflowId="workflow-1"
        onSelectWorkflow={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

    expect(cloud.useWorkflowDefinition).toHaveBeenCalledWith("workflow-1", "user-1");

    const title = screen.getByLabelText("Title") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "My unsaved title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText(/changed in another window/u);
    expect(title.value).toBe("My unsaved title");
    expect(cloud.refetchDetail).not.toHaveBeenCalled();
  });

  it("returns to the list after a no-reload create then cancel", async () => {
    const props = {
      authCacheScope: "user-1",
      onSelectWorkflow: vi.fn(),
      onBackToList: vi.fn(),
    };
    const { rerender } = render(<WorkflowDefinitionsSurface {...props} />);

    fireEvent.click(screen.getAllByRole("button", { name: "New workflow" })[0]!);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Triage" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Investigate" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(props.onSelectWorkflow).toHaveBeenCalledWith("workflow-1"));

    // The parent navigates to the saved editor, then the user goes back to the
    // list. The stale creating flag must not reopen a blank New workflow form.
    rerender(<WorkflowDefinitionsSurface {...props} selectedWorkflowId="workflow-1" />);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Saved title");

    rerender(<WorkflowDefinitionsSurface {...props} selectedWorkflowId={null} />);
    expect(screen.getAllByRole("button", { name: "New workflow" }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Title")).toBeNull();
  });

  it("keeps the draft across a passive revision refetch and replaces it only on Reload", async () => {
    const newerServer = {
      ...persisted,
      revision: 3,
      title: "Server title",
    };
    const props = {
      authCacheScope: "user-1",
      selectedWorkflowId: "workflow-1",
      onSelectWorkflow: vi.fn(),
      onBackToList: vi.fn(),
    };
    const { rerender } = render(<WorkflowDefinitionsSurface {...props} />);

    const title = screen.getByLabelText("Title") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "My unsaved title" } });

    // A passive background refetch bumps the detail revision N -> N+1.
    cloud.useWorkflowDefinition.mockReturnValue({
      data: newerServer,
      isLoading: false,
      isError: false,
      refetch: cloud.refetchDetail,
    });
    rerender(<WorkflowDefinitionsSurface {...props} />);

    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("My unsaved title");
    screen.getByText(/newer revision of this workflow is available/u);

    cloud.refetchDetail.mockResolvedValue({ data: newerServer });
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Server title"),
    );
    expect(cloud.refetchDetail).toHaveBeenCalledTimes(1);
  });

  it("offers a deliberate reload after a revision conflict and adopts the newer value", async () => {
    cloud.update.mockRejectedValue(
      new ProliferateClientError("stale revision", 409, "workflow_revision_conflict"),
    );
    render(
      <WorkflowDefinitionsSurface
        authCacheScope="user-1"
        selectedWorkflowId="workflow-1"
        onSelectWorkflow={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

    const title = screen.getByLabelText("Title") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "My unsaved title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/changed in another window/u);
    expect(title.value).toBe("My unsaved title");

    cloud.refetchDetail.mockResolvedValue({
      data: { ...persisted, revision: 3, title: "Winner title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Winner title"),
    );
    expect(screen.queryByText(/changed in another window/u)).toBeNull();
  });

  it("adopts its own successful save without a remount", async () => {
    const savedResponse = { ...persisted, revision: 3, title: "Saved twice" };
    cloud.update.mockResolvedValue(savedResponse);
    render(
      <WorkflowDefinitionsSurface
        authCacheScope="user-1"
        selectedWorkflowId="workflow-1"
        onSelectWorkflow={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Saved twice" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(cloud.update).toHaveBeenCalledWith({
      workflowDefinitionId: "workflow-1",
      body: expect.objectContaining({ expectedRevision: 2, title: "Saved twice" }),
    }));
    // The next save must use the adopted revision, not the stale base.
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Saved thrice" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(cloud.update).toHaveBeenCalledWith({
      workflowDefinitionId: "workflow-1",
      body: expect.objectContaining({ expectedRevision: 3, title: "Saved thrice" }),
    }));
  });
});
