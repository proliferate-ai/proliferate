// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinitionRecordV2 } from "@proliferate/cloud-sdk";
import { WORKFLOW_STARTER_TEMPLATES_V2 } from "#product/config/workflows/starter-templates";
import { useWorkflowBuilder } from "#product/hooks/workflows/facade/use-workflow-builder";
import {
  linearEdges,
  nextNodeId,
} from "#product/lib/domain/workflows/workflow-builder-draft";

const mocks = vi.hoisted(() => ({
  detailQuery: {
    data: undefined as WorkflowDefinitionRecordV2 | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(async () => ({})),
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

const [AGENT_ENGINEERING_PROCESS, RESEARCH_AND_REVIEW] = WORKFLOW_STARTER_TEMPLATES_V2;

beforeEach(() => {
  mocks.detailQuery.data = undefined;
  mocks.detailQuery.isLoading = false;
  mocks.detailQuery.isError = false;
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.create.mockResolvedValue(savedRecord());
  mocks.update.mockResolvedValue({ ...savedRecord(), revision: 8 });
});

afterEach(() => {
  cleanup();
});

describe("useWorkflowBuilder validation gating", () => {
  it("makes no write while a prompt references an undeclared document", async () => {
    const { result } = renderBuilder();

    act(() => {
      result.current.actions.setTitle("Issue triage");
      result.current.actions.updateNode("step-1", {
        prompt: "Record what you find in @doc:findings.",
      });
    });

    expect(result.current.issues.map((issue) => issue.code)).toEqual(["unknown_doc_ref"]);
    expect(result.current.canSave).toBe(false);

    let saved: unknown = "unset";
    await act(async () => {
      saved = await result.current.save();
    });

    expect(saved).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("writes once the reference resolves (negative control for the gate)", async () => {
    const { result } = renderBuilder();

    act(() => {
      result.current.actions.setTitle("Issue triage");
      result.current.actions.updateNode("step-1", {
        prompt: "Record what you find in @doc:findings.",
      });
      result.current.actions.addDocTemplate();
    });
    // Declaring the document is the ONLY change between this test and the one
    // above; everything else — title, prompt, node — is identical.
    act(() => {
      result.current.actions.updateDocTemplate(0, { slug: "findings" });
    });

    expect(result.current.issues).toEqual([]);
    expect(result.current.canSave).toBe(true);

    await act(async () => {
      await result.current.save();
    });

    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});

describe("useWorkflowBuilder chain order", () => {
  it("seeds a starter template clean, in its own node order", () => {
    const { result } = renderBuilder({ template: AGENT_ENGINEERING_PROCESS });

    expect(result.current.issues).toEqual([]);
    expect(result.current.draft.nodes.map((node) => node.id)).toEqual(
      AGENT_ENGINEERING_PROCESS.definition.nodes.map((node) => node.id),
    );
    expect(result.current.draft.title).toBe(AGENT_ENGINEERING_PROCESS.title);
    expect(result.current.draft.inputs.map((input) => input.name)).toEqual(["goal", "constraints"]);
  });

  it("rebuilds the edge list linearly when a step moves down", () => {
    const { result } = renderBuilder({ template: RESEARCH_AND_REVIEW });

    expect(result.current.definition.edges).toEqual([{ from: "research", to: "review" }]);

    act(() => {
      result.current.actions.moveNodeDown("research");
    });

    expect(result.current.draft.nodes.map((node) => node.id)).toEqual(["review", "research"]);
    expect(result.current.definition.edges).toEqual([{ from: "review", to: "research" }]);
    // Reordering rewrites the chain rather than breaking it: the definition
    // stays linear, so the reorder never invents a validation failure.
    expect(result.current.issues).toEqual([]);
  });

  it("seeds an existing record in chain order, not stored array order", () => {
    mocks.detailQuery.data = {
      ...savedRecord(),
      definition: {
        schemaVersion: 2,
        nodes: [
          { id: "b", type: "agent", title: "Second", prompt: "" },
          { id: "a", type: "agent", title: "First", prompt: "" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
    };
    const { result } = renderBuilder({ definitionId: "wf-1" });

    expect(result.current.status).toBe("ready");
    expect(result.current.draft.nodes.map((node) => node.id)).toEqual(["a", "b"]);
  });
});

describe("useWorkflowBuilder save mapping", () => {
  it("creates with an empty description when none was written", async () => {
    const { result } = renderBuilder();

    act(() => {
      result.current.actions.setTitle("  Issue triage  ");
    });
    await act(async () => {
      await result.current.save();
    });

    expect(mocks.create).toHaveBeenCalledWith({
      title: "Issue triage",
      description: "",
      // Sent explicitly rather than omitted: a workflow with no default asks
      // for a repository at launch instead.
      defaultRepoConfigId: null,
      definition: {
        schemaVersion: 2,
        nodes: [{ id: "step-1", type: "agent", title: "", prompt: "" }],
        edges: [],
        inputs: [],
        docTemplates: [],
      },
    });
    expect(result.current.saved).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it("updates against the loaded record's revision", async () => {
    mocks.detailQuery.data = savedRecord();
    const { result } = renderBuilder({ definitionId: "wf-1" });

    act(() => {
      result.current.actions.setTitle("Renamed");
    });
    await act(async () => {
      await result.current.save();
    });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      workflowDefinitionId: "wf-1",
      body: expect.objectContaining({
        title: "Renamed",
        description: "Triage inbound issues",
        defaultRepoConfigId: "repo-1",
        expectedRevision: 7,
      }),
    });
  });

  it("carries the revision the server answered with into the next update", async () => {
    mocks.detailQuery.data = savedRecord();
    const { result } = renderBuilder({ definitionId: "wf-1" });

    act(() => {
      result.current.actions.setTitle("Renamed");
    });
    await act(async () => {
      await result.current.save();
    });
    act(() => {
      result.current.actions.setTitle("Renamed twice");
    });
    await act(async () => {
      await result.current.save();
    });

    expect(mocks.update.mock.calls[1][0].body.expectedRevision).toBe(8);
  });

  it("surfaces a revision conflict without clearing the draft", async () => {
    mocks.detailQuery.data = savedRecord();
    mocks.update.mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 }));
    const { result } = renderBuilder({ definitionId: "wf-1" });

    act(() => {
      result.current.actions.setTitle("Renamed");
    });
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.error).toContain("changed in another window");
    expect(result.current.draft.title).toBe("Renamed");
    expect(result.current.saving).toBe(false);
  });
});

describe("useWorkflowBuilder declaration grammar gating", () => {
  it("makes no write while a declared input name breaks the wire grammar", async () => {
    const { result } = renderBuilder();

    act(() => {
      result.current.actions.setTitle("Issue triage");
      result.current.actions.addInput();
    });
    act(() => {
      result.current.actions.updateInput(0, { name: "my input" });
    });

    expect(result.current.issues.map((issue) => issue.code)).toEqual(["invalid_input_name"]);
    expect(result.current.canSave).toBe(false);

    await act(async () => {
      await result.current.save();
    });

    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("writes once the name matches the grammar (negative control for the gate)", async () => {
    const { result } = renderBuilder();

    act(() => {
      result.current.actions.setTitle("Issue triage");
      result.current.actions.addInput();
    });
    // The name is the ONLY difference from the test above.
    act(() => {
      result.current.actions.updateInput(0, { name: "my_input" });
    });

    expect(result.current.issues).toEqual([]);
    await act(async () => {
      await result.current.save();
    });

    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("lowercases a doc slug as it is typed without rewriting an unrescuable one", () => {
    const { result } = renderBuilder();

    act(() => {
      result.current.actions.setTitle("Issue triage");
      result.current.actions.addDocTemplate();
    });
    act(() => {
      result.current.actions.updateDocTemplate(0, { slug: " Research-Findings " });
    });

    expect(result.current.draft.docTemplates[0].slug).toBe("research-findings");
    expect(result.current.issues).toEqual([]);

    act(() => {
      result.current.actions.updateDocTemplate(0, { slug: "My_Doc" });
    });

    expect(result.current.draft.docTemplates[0].slug).toBe("my_doc");
    expect(result.current.issues.map((issue) => issue.code)).toEqual(["invalid_doc_slug"]);
    expect(result.current.canSave).toBe(false);
  });
});

describe("useWorkflowBuilder default repository", () => {
  it("carries a picked runtime repo root into the saved default", async () => {
    const { result } = renderBuilder();

    act(() => {
      result.current.actions.setTitle("Issue triage");
      result.current.actions.setDefaultRepoConfigId("repo-2");
    });

    expect(result.current.repoDefaultUnavailable).toBe(false);
    await act(async () => {
      await result.current.save();
    });

    expect(mocks.create.mock.calls[0][0].defaultRepoConfigId).toBe("repo-2");
  });

  it("refuses to save a stored default the runtime does not list", async () => {
    mocks.detailQuery.data = savedRecord();
    const { result } = renderBuilder({
      definitionId: "wf-1",
      availableRepoRootIds: ["repo-2"],
    });

    act(() => {
      result.current.actions.setTitle("Renamed");
    });

    // The definition itself is valid — only the repository is unknown here.
    expect(result.current.issues).toEqual([]);
    expect(result.current.repoDefaultUnavailable).toBe(true);
    expect(result.current.canSave).toBe(false);

    await act(async () => {
      await result.current.save();
    });
    expect(mocks.update).not.toHaveBeenCalled();

    // Negative control: picking a listed root is the only change.
    act(() => {
      result.current.actions.setDefaultRepoConfigId("repo-2");
    });
    expect(result.current.canSave).toBe(true);

    await act(async () => {
      await result.current.save();
    });
    expect(mocks.update.mock.calls[0][0].body.defaultRepoConfigId).toBe("repo-2");
  });

  it("holds a save while the runtime's list is unknown, but not a draft with no default", () => {
    mocks.detailQuery.data = savedRecord();
    const stored = renderBuilder({ definitionId: "wf-1", availableRepoRootIds: null });

    act(() => {
      stored.result.current.actions.setTitle("Renamed");
    });
    expect(stored.result.current.canSave).toBe(false);

    // A workflow that names no repository is unaffected by an unreachable
    // runtime: there is no id to confirm, and the run picks one at launch.
    mocks.detailQuery.data = undefined;
    const fresh = renderBuilder({ availableRepoRootIds: null });
    act(() => {
      fresh.result.current.actions.setTitle("Issue triage");
    });
    expect(fresh.result.current.canSave).toBe(true);
  });
});

describe("useWorkflowBuilder draft edits", () => {
  it("mints ids that never collide with a sibling", () => {
    expect(nextNodeId([{ id: "step-1", type: "agent", title: "", prompt: "" }]))
      .toBe("step-2");
    expect(nextNodeId([
      { id: "step-2", type: "agent", title: "", prompt: "" },
      { id: "step-3", type: "agent", title: "", prompt: "" },
    ])).toBe("step-4");
  });

  it("derives no edge from a single step", () => {
    expect(linearEdges([{ id: "only", type: "agent", title: "", prompt: "" }])).toEqual([]);
  });

  it("reports a document orphaned by removing the step that wrote it", () => {
    const { result } = renderBuilder({ template: RESEARCH_AND_REVIEW });

    act(() => {
      result.current.actions.removeNode("research");
    });

    expect(result.current.issues.map((issue) => issue.code)).toContain("unknown_producing_node");
    expect(result.current.canSave).toBe(false);
  });
});

/**
 * `availableRepoRootIds` defaults to the ids the fixtures use, so a test only
 * passes it when the runtime's list is what it is testing.
 */
function renderBuilder(args: {
  definitionId?: string | null;
  template?: (typeof WORKFLOW_STARTER_TEMPLATES_V2)[number] | null;
  availableRepoRootIds?: readonly string[] | null;
} = {}) {
  return renderHook(() => useWorkflowBuilder({
    definitionId: args.definitionId ?? null,
    template: args.template ?? null,
    authCacheScope: "user-1",
    availableRepoRootIds: args.availableRepoRootIds === undefined
      ? ["repo-1", "repo-2"]
      : args.availableRepoRootIds,
  }));
}

function savedRecord(): WorkflowDefinitionRecordV2 {
  return {
    id: "wf-1",
    userId: "user-1",
    title: "Issue triage",
    description: "Triage inbound issues",
    schemaVersion: 2,
    revision: 7,
    defaultRepoConfigId: "repo-1",
    definition: {
      schemaVersion: 2,
      nodes: [{ id: "diagnose", type: "agent", title: "Diagnose", prompt: "Investigate." }],
      edges: [],
      inputs: [],
      docTemplates: [],
    },
    createdAt: "2026-08-14T12:00:00Z",
    updatedAt: "2026-08-14T12:00:00Z",
    deletedAt: null,
  };
}
