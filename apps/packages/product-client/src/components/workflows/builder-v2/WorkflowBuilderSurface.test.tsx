// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RepoRoot } from "@anyharness/sdk";
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

const RESEARCH_AND_REVIEW = WORKFLOW_STARTER_TEMPLATES_V2.find(
  (template) => template.slug === "bug-investigation",
)!;

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

describe("WorkflowBuilderSurface", () => {
  it("draws the template's chain on the canvas and edits one step at a time", () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={RESEARCH_AND_REVIEW}
        authCacheScope="user-1"
      />,
    );

    // Both steps sit on the canvas as selectable cards; the inspector under
    // it opens on the first step and edits exactly one at a time.
    expect(screen.getByRole("button", { name: /^01AgentResearch/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Step 1" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Step 2" })).toBeNull();
    // Step 1 heads the chain, so it cannot move up.
    expect(screen.getByRole("button", { name: "Move step 1 up" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Move step 1 down" }))
      .toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: /^02Human in the loopReview the findings/ }));

    expect(screen.getByRole("heading", { name: "Step 2" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Step 1" })).toBeNull();
    // Step 2 tails the chain, so it cannot move down.
    expect(screen.getByRole("button", { name: "Move step 2 down" }))
      .toHaveProperty("disabled", true);
  });

  it("selects a just-added step so its fields are ready to edit", () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={RESEARCH_AND_REVIEW}
        authCacheScope="user-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Human in the loop" }));

    expect(screen.getByRole("heading", { name: "Step 3" })).toBeTruthy();
    // The palette's second entry mints a gated step, not an agent.
    expect(screen.getByLabelText("Requires human approval").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", true);

    fireEvent.pointerDown(screen.getByLabelText("Connect from Review the findings"));
    fireEvent.pointerUp(screen.getByLabelText("Connect into step-3"));
    // Connected but still blank: a minted step carries neither of the two
    // fields every plane requires, so it stays unsavable until both are typed.
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", true);
    completeSelectedStep();
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", false);
  });

  it("authors connections with keyboard-only port activation and announces the armed source", async () => {
    const user = userEvent.setup();
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={RESEARCH_AND_REVIEW}
        authCacheScope="user-1"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Agent" }));
    const source = screen.getByLabelText("Connect from Review the findings");
    const target = screen.getByLabelText("Connect into step-3");

    source.focus();
    await user.keyboard("{Enter}");
    expect(source.getAttribute("aria-pressed")).toBe("true");
    expect(source.getAttribute("aria-description")).toContain("start a connection");
    target.focus();
    await user.keyboard(" ");

    expect(screen.getByLabelText("Remove connection from review to step-3")).toBeTruthy();
    completeSelectedStep();
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", false);

    // Self-edge, duplicate, and structural-Input target negative controls.
    source.focus();
    await user.keyboard("{Enter}");
    screen.getByLabelText("Connect into Review the findings").focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByLabelText("Remove connection from review to review")).toBeNull();
    expect(screen.queryByLabelText("Connect into Input")).toBeNull();
    source.focus();
    await user.keyboard("{Enter}");
    target.focus();
    await user.keyboard("{Enter}");
    expect(screen.getAllByLabelText("Remove connection from review to step-3")).toHaveLength(1);
  });

  it("clears abandoned pointer connections on background release, cancellation, lost capture, and Escape", () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={RESEARCH_AND_REVIEW}
        authCacheScope="user-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const canvas = screen.getByRole("group", { name: "Workflow chain" });
    const source = screen.getByLabelText("Connect from Review the findings");
    const target = screen.getByLabelText("Connect into step-3");

    const abandon = (cancel: () => void) => {
      fireEvent.pointerDown(source, { pointerId: 7 });
      expect(source.getAttribute("aria-pressed")).toBe("true");
      cancel();
      expect(source.getAttribute("aria-pressed")).toBe("false");
      fireEvent.pointerUp(target, { pointerId: 7 });
      expect(screen.queryByLabelText("Remove connection from review to step-3")).toBeNull();
    };

    abandon(() => fireEvent.pointerUp(canvas, { pointerId: 7 }));
    abandon(() => fireEvent.pointerCancel(source, { pointerId: 7 }));
    abandon(() => fireEvent.lostPointerCapture(source, { pointerId: 7 }));
    abandon(() => fireEvent.keyDown(source, { key: "Escape" }));

    // Negative control: the production pointer-down -> pointer-up gesture
    // still authors exactly one edge.
    fireEvent.pointerDown(source, { pointerId: 8 });
    fireEvent.pointerUp(target, { pointerId: 8 });
    expect(screen.getByLabelText("Remove connection from review to step-3")).toBeTruthy();
  });

  it("disables canvas mutation and routing-sensitive shortcuts while create is pending", async () => {
    const pending = controlledPromise<WorkflowDefinitionRecordV2>();
    mocks.create.mockReturnValue(pending.promise);
    const onSaved = vi.fn();
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={RESEARCH_AND_REVIEW}
        authCacheScope="user-1"
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Workflow" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));

    const canvas = screen.getByRole("group", { name: "Workflow chain" });
    const edgeControl = screen.getByLabelText("Remove connection from research to review");
    expect(edgeControl).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Connect from Review the findings")).toHaveProperty("disabled", true);
    fireEvent.keyDown(canvas, { key: "Delete" });
    fireEvent.keyDown(canvas, { key: "z", metaKey: true });
    fireEvent.click(edgeControl);
    expect(screen.getByRole("button", { name: /^02Human in the loopReview the findings/ })).toBeTruthy();
    expect(screen.getByLabelText("Remove connection from research to review")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();

    pending.resolve(createdRecord());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("wf-new"));
  });

  it("keeps invalid JSON for correction without mutating the last valid graph", () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={RESEARCH_AND_REVIEW}
        authCacheScope="user-1"
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "JSON" }));
    const editor = screen.getByLabelText("Workflow definition JSON");
    expect((editor as HTMLTextAreaElement).value).toContain('"schemaVersion": 2');
    const editedDefinition = JSON.parse((editor as HTMLTextAreaElement).value);
    editedDefinition.nodes[0].title = "Investigate atomically";
    fireEvent.change(editor, { target: { value: JSON.stringify(editedDefinition) } });
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    expect((editor as HTMLTextAreaElement).value).toContain('\n  "nodes":');
    fireEvent.click(screen.getByRole("radio", { name: "Graph" }));
    expect(screen.getByRole("button", { name: /^01AgentInvestigate atomically/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "JSON" }));
    fireEvent.change(editor, { target: { value: '{"schemaVersion": 2' } });
    expect(screen.getByText("JSON syntax is invalid.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("radio", { name: "Graph" }));
    expect(screen.getByRole("button", { name: /^01AgentInvestigate atomically/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", true);
    // The graph view cannot show the JSON error, so the dead Save button says
    // why it is dead.
    expect(screen.getByText(
      "The JSON view holds an invalid definition. Fix or revert it before saving.",
    )).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "JSON" }));
    expect((screen.getByLabelText("Workflow definition JSON") as HTMLTextAreaElement).value)
      .toBe('{"schemaVersion": 2');
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.queryByText("JSON syntax is invalid.")).toBeNull();
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", false);
  });

  it("coalesces adjacent valid JSON edits and starts a new history item after 600 ms", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={null}
        authCacheScope="user-1"
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "JSON" }));
    const editor = screen.getByLabelText("Workflow definition JSON") as HTMLTextAreaElement;
    const first = JSON.parse(editor.value);
    first.nodes[0].title = "Diagnose";
    first.nodes[0].prompt = "A";
    fireEvent.change(editor, { target: { value: JSON.stringify(first) } });
    first.nodes[0].prompt = "AB";
    fireEvent.change(editor, { target: { value: JSON.stringify(first) } });
    vi.advanceTimersByTime(601);
    first.nodes[0].prompt = "ABC";
    fireEvent.change(editor, { target: { value: JSON.stringify(first) } });

    fireEvent.click(screen.getByRole("radio", { name: "Graph" }));
    const canvas = screen.getByRole("group", { name: "Workflow chain" });
    fireEvent.keyDown(canvas, { key: "z", metaKey: true });
    fireEvent.click(screen.getByRole("radio", { name: "JSON" }));
    expect(JSON.parse((screen.getByLabelText("Workflow definition JSON") as HTMLTextAreaElement).value)
      .nodes[0].prompt).toBe("AB");

    fireEvent.click(screen.getByRole("radio", { name: "Graph" }));
    fireEvent.keyDown(canvas, { key: "z", metaKey: true });
    fireEvent.click(screen.getByRole("radio", { name: "JSON" }));
    expect(JSON.parse((screen.getByLabelText("Workflow definition JSON") as HTMLTextAreaElement).value)
      .nodes[0].prompt).toBe("");
    vi.useRealTimers();
  });

  it("uses Delete for selected nodes, keeps Enter inert, and leaves incident edges detached", () => {
    render(
      <WorkflowBuilderSurface
        definitionId={null}
        template={WORKFLOW_STARTER_TEMPLATES_V2[0]}
        authCacheScope="user-1"
      />,
    );
    const canvas = screen.getByRole("group", { name: "Workflow chain" });
    fireEvent.click(screen.getByRole("button", { name: /^02AgentAnswer the questions/ }));
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(screen.getByRole("button", { name: /^02AgentAnswer the questions/ })).toBeTruthy();
    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(screen.queryByRole("button", { name: /^02AgentAnswer the questions/ })).toBeNull();
    expect(screen.getByText(/Nodes and edges must form exactly one linear path/)).toBeTruthy();
    expect(screen.queryByLabelText("Remove connection from research-questions to design")).toBeNull();
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

    completeSelectedStep();
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Give this workflow a title before saving.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Workflow title"), { target: { value: "Issue triage" } });
    expect(screen.getByRole("button", { name: "Save Workflow" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "Save Workflow" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith("wf-new");
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

function controlledPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
