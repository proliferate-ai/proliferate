// @vitest-environment jsdom

// Split out of WorkflowBuilderSurface.test.tsx (repo-shape max-lines):
// the definition-rule and default-repository scenarios reuse the same
// harness shape as the main suite; duplicated here rather than shared so
// this file stays self-contained.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RepoRoot } from "@anyharness/sdk";
import type { WorkflowDefinitionRecordV2 } from "@proliferate/cloud-sdk";
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
  // Runtime repo roots, not cloud repo configs: the runtime resolves the
  // placement a saved default seeds, in its own id space.
  repoRootsQuery: {
    data: undefined as RepoRoot[] | undefined,
    isLoading: false,
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

vi.mock("@anyharness/sdk-react", () => ({
  useRepoRootsQuery: () => mocks.repoRootsQuery,
  useAgentLaunchOptionsListQuery: ({ harnessKinds }: { harnessKinds: readonly string[] }) =>
    harnessKinds.map((harnessKind) => ({
      harnessKind,
      data: harnessKind === "claude" ? {
      harnessKind: "claude",
      basisRevision: "basis-1",
      revision: 1,
      state: "observed",
      options: {
        models: mocks.registriesQuery.data[0].models.map((model) => ({
          id: model.id,
          observedName: model.displayName,
          observedDescription: null,
        })),
        controls: [],
        defaults: { modelId: "sonnet", controlValues: {} },
      },
      observedAt: "2026-08-19T00:00:00Z",
      probeAttemptedAt: "2026-08-19T00:00:00Z",
      probeFailureCode: null,
      readiness: "ready",
    } : null,
      isPending: false,
      isError: false,
    })),
}));

// Hand placements are persisted through the product host, which this surface
// test does not mount; the in-memory stand-in keeps card moving real.
vi.mock("#product/hooks/workflows/workflows/use-workflow-node-layout", async () => {
  const { useCallback, useState } = await import("react");
  return {
    useWorkflowNodeLayout: () => {
      const [placements, setPlacements] = useState({});
      return {
        placements,
        moveNode: useCallback((nodeKey: string, placement: { x: number; y: number }) =>
          setPlacements((current) => ({ ...current, [nodeKey]: placement })), []),
      };
    },
  };
});

beforeEach(() => {
  mocks.detailQuery.data = undefined;
  mocks.detailQuery.isLoading = false;
  mocks.repoRootsQuery.data = repoRoots();
  mocks.repoRootsQuery.isLoading = false;
  mocks.repoRootsQuery.isError = false;
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.create.mockResolvedValue(createdRecord());
  mocks.update.mockResolvedValue({ ...createdRecord(), revision: 2 });
});

afterEach(() => {
  cleanup();
});

describe("WorkflowBuilderSurface definition rules", () => {
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

    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", true);
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

  it("keeps the model pick when a step is toggled to require approval", async () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={null}
        authCacheScope="user-1"
      />,
    );

    fireEvent.change(screen.getByLabelText("Workflow title"), { target: { value: "Issue triage" } });
    completeSelectedStep();
    fireEvent.change(screen.getByLabelText("Harness"), { target: { value: "claude" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "opus" } });

    fireEvent.click(screen.getByLabelText("Requires human approval"));

    // A gated step still runs an agent session, so the model configuration
    // survives the toggle: the fields stay rendered, editable, and populated.
    expect(screen.queryByText("The run pauses here until someone approves the step.")).toBeNull();
    expect(screen.getByLabelText("Harness")).toHaveProperty("disabled", false);
    expect(screen.getByLabelText("Model")).toHaveProperty("value", "opus");

    fireEvent.click(screen.getByRole("button", { name: "Save Workflow" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    // The wire shape is unchanged by design: the saved node carries both the
    // gate and the model.
    expect(mocks.create.mock.calls[0][0].definition.nodes[0]).toMatchObject({
      type: "human_in_loop",
      model: { agentKind: "claude", modelId: "opus" },
    });

    // Toggling back off keeps it too — the toggle only moves `type`.
    fireEvent.click(screen.getByLabelText("Requires human approval"));
    expect(screen.getByLabelText("Model")).toHaveProperty("value", "opus");
  });

  it("chips a malformed prompt reference and blocks Save", () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={null}
        authCacheScope="user-1"
      />,
    );

    fireEvent.change(screen.getByLabelText("Workflow title"), { target: { value: "Issue triage" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Diagnose" } });
    // `@doc:plan.md` is well-formed prose and a malformed reference: declaring
    // a document cannot rescue it, so it must block the save on its own.
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Read @doc:plan.md first." },
    });

    expect(screen.getByText("@doc:plan.md").getAttribute("data-malformed")).toBe("true");
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", true);
    const alerts = screen.getAllByRole("alert").map((node) => node.textContent ?? "");
    expect(alerts.some((text) => text.includes("malformed reference “@doc:plan.md”"))).toBe(true);

    // Negative control: the same prompt with a well-formed slug saves once the
    // document is declared.
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Read @doc:plan first." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "plan" } });
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", false);
  });

  it("marks a node id the grammar refuses on the id itself", () => {
    // Ids are minted valid, so this can only arrive from a definition authored
    // elsewhere — the case the badge has to be honest about.
    mocks.detailQuery.data = {
      ...createdRecord(),
      definition: {
        schemaVersion: 2,
        nodes: [{ id: "2-step", type: "agent", title: "Diagnose", prompt: "" }],
        edges: [],
        inputs: [],
        docTemplates: [],
      },
    };
    render(
      <WorkflowBuilderSurface
        definitionId="wf-new"
        authCacheScope="user-1"
      />,
    );

    expect(screen.getByText("2-step").getAttribute("data-invalid")).toBe("true");
    fireEvent.change(screen.getByLabelText("Workflow title"), { target: { value: "Renamed" } });
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", true);
  });

  it("reports a declared input name against its own row and blocks Save", () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={null}
        authCacheScope="user-1"
      />,
    );

    fireEvent.change(screen.getByLabelText("Workflow title"), { target: { value: "Issue triage" } });
    completeSelectedStep();
    fireEvent.click(screen.getByRole("button", { name: /Trigger payload/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add input" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "my input" } });

    // The value the author typed is kept verbatim — a silent rename would
    // change what every prompt has to spell — and the field carries the error.
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "my input");
    expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe("true");
    const alerts = screen.getAllByRole("alert").map((node) => node.textContent ?? "");
    expect(alerts.some((text) => text.includes("Input name “my input” must start with a letter")))
      .toBe(true);
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", true);

    // Negative control: one grammatical name away from savable.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "my_input" } });
    expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", false);
  });

  it("lowercases a doc slug as it is typed and reports what it cannot rescue", () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={null}
        authCacheScope="user-1"
      />,
    );

    fireEvent.change(screen.getByLabelText("Workflow title"), { target: { value: "Issue triage" } });
    completeSelectedStep();
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: " Research-Findings " } });

    expect(screen.getByLabelText("Slug")).toHaveProperty("value", "research-findings");
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", false);

    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "My_Doc" } });

    expect(screen.getByLabelText("Slug")).toHaveProperty("value", "my_doc");
    expect(screen.getByLabelText("Slug").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", true);
  });

  it("offers the runtime's repo roots as the default repository", () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={null}
        authCacheScope="user-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Trigger payload/ }));
    const picker = screen.getByLabelText("Default repository");
    expect([...(picker as HTMLSelectElement).options].map((option) => [
      option.value,
      option.textContent,
    ])).toEqual([
      ["", "Ask at launch"],
      ["root-1", "proliferate"],
      ["root-2", "sidecar"],
    ]);
  });

  it("saves the picked repo root as the definition's default", async () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={null}
        authCacheScope="user-1"
      />,
    );

    fireEvent.change(screen.getByLabelText("Workflow title"), { target: { value: "Issue triage" } });
    completeSelectedStep();
    fireEvent.click(screen.getByRole("button", { name: /Trigger payload/ }));
    fireEvent.change(screen.getByLabelText("Default repository"), {
      target: { value: "root-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Workflow" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    // The runtime repo-root id travels verbatim: the trigger dialog seeds
    // `placement.repoConfigId` from this field.
    expect(mocks.create.mock.calls[0][0].defaultRepoConfigId).toBe("root-2");
  });

  it("blocks Save while the saved default is not a listed repo root", () => {
    mocks.detailQuery.data = { ...createdRecord(), defaultRepoConfigId: "repo-config-9" };
    render(
      <WorkflowBuilderSurface
        definitionId="wf-new"
        authCacheScope="user-1"
      />,
    );

    // Edit something first: an untouched record has nothing to save either way.
    fireEvent.change(screen.getByLabelText("Workflow title"), { target: { value: "Renamed" } });

    fireEvent.click(screen.getByRole("button", { name: /Trigger payload/ }));
    expect(screen.getByText("Saved repository unavailable (repo-config-9)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", true);

    // Negative control: the same edit saves once a listed root is picked.
    fireEvent.change(screen.getByLabelText("Default repository"), {
      target: { value: "root-1" },
    });
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", false);
  });

  it("says so when the runtime's repositories cannot be loaded", () => {
    mocks.repoRootsQuery.data = undefined;
    mocks.repoRootsQuery.isError = true;
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={null}
        authCacheScope="user-1"
      />,
    );

    expect(screen.getByText(
      "Repositories could not be loaded from the runtime. Reconnect to change this workflow's "
      + "default repository.",
    )).toBeTruthy();
    // A workflow that names no repository is still savable: the run picks one.
    fireEvent.change(screen.getByLabelText("Workflow title"), { target: { value: "Issue triage" } });
    completeSelectedStep();
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", false);
  });

});

/**
 * Fill the inspector's step fields. A minted step carries neither, and both
 * are wire-required, so every save-path test has to type them.
 */
function completeSelectedStep(prompt = "Investigate the report.") {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Diagnose" } });
  fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: prompt } });
}

function repoRoots(): RepoRoot[] {
  return [
    {
      id: "root-1",
      kind: "external",
      path: "/Users/dev/code/proliferate",
      displayName: "proliferate",
      createdAt: "2026-08-14T12:00:00Z",
      updatedAt: "2026-08-14T12:00:00Z",
    },
    // No `displayName`: the label falls back to the folder name.
    {
      id: "root-2",
      kind: "managed",
      path: "/Users/dev/code/sidecar",
      createdAt: "2026-08-14T12:00:00Z",
      updatedAt: "2026-08-14T12:00:00Z",
    },
  ];
}

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
      nodes: [{ id: "step-1", type: "agent", title: "Diagnose", prompt: "Investigate." }],
      edges: [],
      inputs: [],
      docTemplates: [],
    },
    createdAt: "2026-08-14T12:00:00Z",
    updatedAt: "2026-08-14T12:00:00Z",
    deletedAt: null,
  };
}
