// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const detail = vi.fn();

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/access/cloud/workflows/use-workflows", () => ({
  useWorkflowDetail: () => detail(),
}));
vi.mock("@/hooks/access/cloud/workflows/use-workflow-mutations", () => ({
  useWorkflowMutations: () => ({
    updateMutation: { mutate: vi.fn(), isPending: false },
    createMutation: { mutate: vi.fn(), isPending: false },
  }),
}));

import { useWorkflowEditorDraft } from "./use-workflow-editor-draft";

afterEach(() => {
  vi.clearAllMocks();
});

function withDetail(definition: unknown) {
  detail.mockReturnValue({
    isError: false,
    data: {
      workflow: { id: "wf-1", name: "Demo", description: null, isSeed: false },
      currentVersion: definition === undefined ? null : { definition },
    },
  });
}

describe("useWorkflowEditorDraft — read-only unsupported versions (WS9b item 6)", () => {
  it("marks an unknown definition version read-only (never seeds a droppable draft)", () => {
    withDetail({ version: 99, inputs: [], integrations: [], agents: [] });
    const { result } = renderHook(() => useWorkflowEditorDraft("wf-1"));
    expect(result.current.unsupported).toEqual({ reason: "version", version: 99 });
    expect(result.current.draft).toBeNull();
  });

  it("marks an unknown step kind read-only", () => {
    withDetail({
      version: 1,
      inputs: [],
      integrations: [],
      agents: [{ slot: "a", harness: "claude", model: "haiku", steps: [{ kind: "future.step" }] }],
    });
    const { result } = renderHook(() => useWorkflowEditorDraft("wf-1"));
    expect(result.current.unsupported).toEqual({ reason: "step_kind", version: 1 });
    expect(result.current.draft).toBeNull();
  });

  it("seeds an editable draft with stable IDs for a supported definition", () => {
    withDetail({
      version: 1,
      inputs: [],
      integrations: [],
      agents: [{ slot: "a", harness: "claude", model: "haiku", steps: [{ kind: "agent.prompt", prompt: "hi" }] }],
    });
    const { result } = renderHook(() => useWorkflowEditorDraft("wf-1"));
    expect(result.current.unsupported).toBeNull();
    expect(result.current.draft).not.toBeNull();
    const node = result.current.definition!.agents[0] as { id?: string; slotId?: string; steps: { id?: string }[] };
    expect(node.id).toBeTruthy();
    expect(node.slotId).toBeTruthy();
    expect(node.steps[0]!.id).toBeTruthy();
  });

  it("seeds a fresh single-agent draft when there is no stored definition", () => {
    withDetail(undefined);
    const { result } = renderHook(() => useWorkflowEditorDraft("wf-1"));
    expect(result.current.unsupported).toBeNull();
    expect(result.current.definition!.agents).toHaveLength(1);
  });
});
