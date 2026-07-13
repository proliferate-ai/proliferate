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

vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

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
});
