// @vitest-environment jsdom

// Split out of use-workflow-builder.test.tsx (repo-shape max-lines): the
// write path — save mapping, revisions, and the default-repository gate —
// reuses the same harness shape as the main suite; duplicated here rather
// than shared so this file stays self-contained.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinitionRecordV2 } from "@proliferate/cloud-sdk";
import { WORKFLOW_STARTER_TEMPLATES_V2 } from "#product/config/workflows/starter-templates";
import { useWorkflowBuilder } from "#product/hooks/workflows/facade/use-workflow-builder";

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

const BUG_INVESTIGATION = WORKFLOW_STARTER_TEMPLATES_V2.find(
  (template) => template.slug === "bug-investigation",
)!;

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
