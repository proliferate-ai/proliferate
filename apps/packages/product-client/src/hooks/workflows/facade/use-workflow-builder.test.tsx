// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinitionRecordV2, WorkflowDefinitionV2 } from "@proliferate/cloud-sdk";
import { WORKFLOW_STARTER_TEMPLATES_V2 } from "#product/config/workflows/starter-templates";
import { useWorkflowBuilder } from "#product/hooks/workflows/facade/use-workflow-builder";
import { nextNodeId } from "#product/lib/domain/workflows/workflow-builder-draft";

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

const AGENT_ENGINEERING_PROCESS = WORKFLOW_STARTER_TEMPLATES_V2[0];
const BUG_INVESTIGATION = WORKFLOW_STARTER_TEMPLATES_V2.find(
  (template) => template.slug === "bug-investigation",
)!;

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
        title: "Diagnose",
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
        title: "Diagnose",
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

describe("useWorkflowBuilder authored graph", () => {
  it("seeds a starter template clean, in its own node order", () => {
    const { result } = renderBuilder({ template: AGENT_ENGINEERING_PROCESS });

    expect(result.current.issues).toEqual([]);
    expect(result.current.draft.nodes.map((node) => node.id)).toEqual(
      AGENT_ENGINEERING_PROCESS.definition.nodes.map((node) => node.id),
    );
    expect(result.current.draft.title).toBe(AGENT_ENGINEERING_PROCESS.title);
    expect(result.current.draft.inputs.map((input) => input.name)).toEqual(["goal", "constraints"]);
  });

  it("changes display order without rewiring authored edges", () => {
    const { result } = renderBuilder({ template: BUG_INVESTIGATION });

    expect(result.current.definition.edges).toEqual([{ from: "research", to: "review" }]);

    act(() => {
      result.current.actions.moveNodeDown("research");
    });

    expect(result.current.draft.nodes.map((node) => node.id)).toEqual(["review", "research"]);
    expect(result.current.definition.edges).toEqual([{ from: "research", to: "review" }]);
    expect(result.current.issues).toEqual([]);
  });

  it("preserves stored display order while synthesizing Input to the real head", () => {
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
    expect(result.current.draft.nodes.map((node) => node.id)).toEqual(["b", "a"]);
    expect(result.current.draft.inputConnectedTo).toBe("a");
  });

  it("adds a detached node and refuses to save until it is connected", () => {
    const { result } = renderBuilder({ template: BUG_INVESTIGATION });
    act(() => result.current.actions.addNode());

    expect(result.current.draft.edges).toEqual([{ from: "research", to: "review" }]);
    expect(result.current.issues.map((issue) => issue.code)).toContain("not_linear");
    expect(result.current.canSave).toBe(false);
  });

  it("removes only incident edges and does not heal across a deleted middle node", () => {
    const { result } = renderBuilder({ template: AGENT_ENGINEERING_PROCESS });
    act(() => result.current.actions.removeNode("research"));

    expect(result.current.draft.edges).not.toContainEqual({ from: "research-questions", to: "design" });
    expect(result.current.draft.edges).toEqual([
      { from: "design", to: "design-gate" },
      { from: "design-gate", to: "implement" },
      { from: "implement", to: "review-gate" },
    ]);
    expect(result.current.issues.map((issue) => issue.code)).toContain("not_linear");
    expect(result.current.canSave).toBe(false);
  });
});

describe("useWorkflowBuilder save mapping", () => {
  it("freezes every draft mutation while a controlled save persists its exact snapshot", async () => {
    const pending = controlledPromise<WorkflowDefinitionRecordV2>();
    mocks.create.mockReturnValue(pending.promise);
    const { result } = renderBuilder({ template: BUG_INVESTIGATION });
    const sentDefinition = structuredClone(result.current.definition);
    const originalDraft = structuredClone(result.current.draft);

    let savePromise!: Promise<WorkflowDefinitionRecordV2 | null>;
    act(() => {
      savePromise = result.current.save();
    });
    expect(result.current.saving).toBe(true);

    act(() => {
      result.current.actions.removeNode("review");
      result.current.actions.removeEdge("research", "review");
      result.current.actions.connectNodes("review", "research");
      result.current.actions.disconnectInput();
      result.current.undo();
      result.current.redo();
    });

    expect(result.current.draft).toEqual(originalDraft);
    expect(mocks.create.mock.calls[0][0].definition).toEqual(sentDefinition);

    await act(async () => {
      pending.resolve(savedRecord());
      await savePromise;
    });

    // Negative control: an unchanged pending draft acknowledges the exact
    // snapshot and becomes clean only after that request resolves.
    expect(result.current.saved).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it("retains but refuses a stored model selection missing from the live catalog", () => {
    mocks.detailQuery.data = {
      ...savedRecord(),
      definition: {
        ...savedRecord().definition,
        nodes: [{
          id: "diagnose",
          type: "agent",
          title: "Diagnose",
          prompt: "Investigate.",
          model: { agentKind: "retired-harness", modelId: "retired-model" },
        }],
      },
    };
    const { result } = renderBuilder({
      definitionId: "wf-1",
      availableModelSelections: [{ agentKind: "codex", modelIds: ["gpt-current"] }],
    });

    expect(result.current.draft.nodes[0].model).toEqual({
      agentKind: "retired-harness",
      modelId: "retired-model",
    });
    expect(result.current.modelSelectionUnavailable).toBe(true);
    expect(result.current.canSave).toBe(false);
  });

  it("creates with an empty description when none was written", async () => {
    const { result } = renderBuilder();

    act(() => {
      result.current.actions.setTitle("  Issue triage  ");
      completeStep(result);
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
        nodes: [{ id: "step-1", type: "agent", title: "Diagnose", prompt: "Investigate." }],
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
      completeStep(result);
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
      completeStep(result);
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
      completeStep(result);
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
      completeStep(result);
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
      completeStep(fresh.result);
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

  it("reports a document orphaned by removing the step that wrote it", () => {
    const { result } = renderBuilder({ template: BUG_INVESTIGATION });

    act(() => {
      result.current.actions.removeNode("research");
    });

    expect(result.current.issues.map((issue) => issue.code)).toContain("unknown_producing_node");
    expect(result.current.canSave).toBe(false);
  });

  it("undoes and redoes a structural edit while coalescing adjacent typing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
    const { result } = renderBuilder();
    act(() => {
      result.current.actions.setTitle("I");
      result.current.actions.setTitle("Issue");
    });
    expect(result.current.draft.title).toBe("Issue");
    act(() => result.current.undo());
    expect(result.current.draft.title).toBe("");
    act(() => result.current.redo());
    expect(result.current.draft.title).toBe("Issue");
    vi.advanceTimersByTime(601);
    act(() => result.current.actions.setTitle("Issue triage"));
    act(() => result.current.undo());
    expect(result.current.draft.title).toBe("Issue");
    act(() => result.current.redo());
    expect(result.current.draft.title).toBe("Issue triage");
    vi.useRealTimers();
  });

  it("caps whole-draft undo history at sixty entries", () => {
    const { result } = renderBuilder();
    act(() => {
      for (let index = 0; index < 65; index += 1) {
        result.current.actions.setDefaultRepoConfigId(index % 2 === 0 ? "repo-1" : "repo-2");
      }
    });
    let undos = 0;
    while (result.current.canUndo) {
      act(() => result.current.undo());
      undos += 1;
    }
    expect(undos).toBe(60);
  });

  it("coalesces valid JSON typing within 600 ms without evicting structural history", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
    const { result } = renderBuilder();
    act(() => result.current.actions.setDefaultRepoConfigId("repo-2"));

    act(() => {
      for (let index = 1; index <= 65; index += 1) {
        result.current.actions.replaceDefinition(definitionWithPrompt("x".repeat(index)));
      }
    });
    expect(result.current.definition.nodes[0].prompt).toHaveLength(65);

    act(() => result.current.undo());
    expect(result.current.definition.nodes[0].prompt).toBe("");
    expect(result.current.draft.defaultRepoConfigId).toBe("repo-2");
    act(() => result.current.undo());
    expect(result.current.draft.defaultRepoConfigId).toBe("");
    vi.useRealTimers();
  });
});

function definitionWithPrompt(prompt: string): WorkflowDefinitionV2 {
  return {
    schemaVersion: 2,
    nodes: [{ id: "step-1", type: "agent", title: "", prompt }],
    edges: [],
    inputs: [],
    docTemplates: [],
  };
}

function controlledPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * `availableRepoRootIds` defaults to the ids the fixtures use, so a test only
 * passes it when the runtime's list is what it is testing.
 */
function renderBuilder(args: {
  definitionId?: string | null;
  template?: (typeof WORKFLOW_STARTER_TEMPLATES_V2)[number] | null;
  availableRepoRootIds?: readonly string[] | null;
  availableModelSelections?: readonly { agentKind: string; modelIds: readonly string[] }[] | null;
} = {}) {
  return renderHook(() => useWorkflowBuilder({
    definitionId: args.definitionId ?? null,
    template: args.template ?? null,
    authCacheScope: "user-1",
    availableRepoRootIds: args.availableRepoRootIds === undefined
      ? ["repo-1", "repo-2"]
      : args.availableRepoRootIds,
    availableModelSelections: args.availableModelSelections ?? null,
  }));
}

/**
 * A blank draft mints its step with no title and no prompt — both are wire
 * required, so every test that reaches a write has to fill them in.
 */
function completeStep(result: ReturnType<typeof renderBuilder>["result"]) {
  result.current.actions.updateNode("step-1", { title: "Diagnose", prompt: "Investigate." });
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
