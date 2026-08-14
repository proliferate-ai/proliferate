// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkflowDefinitionRecordV2 } from "@proliferate/cloud-sdk";
import { WORKFLOW_STARTER_TEMPLATES_V2 } from "#product/config/workflows/starter-templates";
import { WorkflowBuilderSurface } from "#product/components/workflows/builder-v2/WorkflowBuilderSurface";

/** `ProductPageShell`'s sticky title observes its viewport; jsdom has no observer. */
class TestIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

const mocks = vi.hoisted(() => ({
  detailQuery: {
    data: undefined as WorkflowDefinitionRecordV2 | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(async () => ({})),
  },
  registriesQuery: {
    data: [{
      kind: "claude",
      displayName: "Claude",
      defaultModelId: "sonnet",
      models: [
        { id: "sonnet", displayName: "Sonnet", isDefault: true },
        { id: "opus", displayName: "Opus", isDefault: false },
      ],
    }],
    isError: false,
  },
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("#product/hooks/access/cloud/workflows/use-workflow-definitions-v2-access", () => ({
  useWorkflowDefinitionV2Access: () => mocks.detailQuery,
  useWorkflowDefinitionV2MutationsAccess: () => ({
    createWorkflowDefinitionV2: mocks.create,
    creatingWorkflowDefinitionV2: false,
    updateWorkflowDefinitionV2: mocks.update,
    updatingWorkflowDefinitionV2: false,
    deleteWorkflowDefinitionV2: mocks.remove,
    deletingWorkflowDefinitionV2: false,
  }),
}));

vi.mock("#product/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog", () => ({
  useCloudLaunchModelRegistries: () => mocks.registriesQuery,
}));

const [, RESEARCH_AND_REVIEW] = WORKFLOW_STARTER_TEMPLATES_V2;

beforeEach(() => {
  mocks.detailQuery.data = undefined;
  mocks.detailQuery.isLoading = false;
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.create.mockResolvedValue(createdRecord());
});

afterEach(() => {
  cleanup();
});

describe("WorkflowBuilderSurface", () => {
  it("renders a template's chain as ordered step cards", () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={RESEARCH_AND_REVIEW}
        authCacheScope="user-1"
      />,
    );

    expect(screen.getByRole("heading", { name: "Step 1" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Step 2" })).toBeTruthy();
    // Step 1 heads the chain, so it cannot move up; step 2 tails it.
    expect(screen.getByRole("button", { name: "Move step 1 up" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Move step 2 down" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Move step 1 down" }))
      .toHaveProperty("disabled", false);
  });

  it("gates Save on a title and creates through the access seam", async () => {
    const onSaved = vi.fn();
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={null}
        authCacheScope="user-1"
        onSaved={onSaved}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Workflow title"), { target: { value: "Issue triage" } });
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith("wf-new");
  });

  it("shows an unresolved reference on the step that spells it and blocks Save", () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={null}
        authCacheScope="user-1"
      />,
    );

    fireEvent.change(screen.getByLabelText("Workflow title"), { target: { value: "Issue triage" } });
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Write @doc:findings." },
    });

    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    const alerts = screen.getAllByRole("alert").map((node) => node.textContent ?? "");
    expect(alerts.some((text) => text.includes("@doc:findings"))).toBe(true);
  });

  it("offers the catalog's models once a harness is picked", () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={null}
        authCacheScope="user-1"
      />,
    );

    expect(screen.getByLabelText("Model")).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Harness"), { target: { value: "claude" } });

    const model = screen.getByLabelText("Model");
    expect(model).toHaveProperty("disabled", false);
    expect([...(model as HTMLSelectElement).options].map((option) => option.value))
      .toEqual(["", "sonnet", "opus"]);
  });

  it("refuses to open a definition that is not schema version 2", () => {
    mocks.detailQuery.data = {
      ...createdRecord(),
      schemaVersion: 2,
      definition: { schemaVersion: 1, stages: [] } as never,
    };
    render(
      <WorkflowBuilderSurface
        definitionId="wf-legacy"
        authCacheScope="user-1"
      />,
    );

    expect(screen.getByText("Not editable here")).toBeTruthy();
  });
});

function createdRecord(): WorkflowDefinitionRecordV2 {
  return {
    id: "wf-new",
    userId: "user-1",
    title: "Issue triage",
    description: "",
    schemaVersion: 2,
    revision: 1,
    defaultRepoConfigId: null,
    definition: {
      schemaVersion: 2,
      nodes: [{ id: "step-1", type: "agent", title: "", prompt: "" }],
      edges: [],
      inputs: [],
      docTemplates: [],
    },
    createdAt: "2026-08-14T12:00:00Z",
    updatedAt: "2026-08-14T12:00:00Z",
    deletedAt: null,
  };
}
