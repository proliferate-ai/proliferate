// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WorkflowRunNodeV2 } from "@anyharness/sdk";
import type {
  WorkflowGraphNodeVM,
  WorkflowGraphSlotVM,
  WorkflowNodeControlSet,
} from "#product/domain/workflows/run-view-model";
import { WorkflowGraphView } from "#product/components/workflows/run-view/WorkflowGraphView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function baseNode(overrides: Partial<WorkflowRunNodeV2> = {}): WorkflowRunNodeV2 {
  return {
    id: "node-1",
    runId: "run-1",
    definitionNodeId: "def-node-1",
    kind: "defined",
    nodeType: "agent",
    replacesNodeRowId: null,
    anchorNodeRowId: null,
    chainIndex: 0,
    title: "Research the topic",
    prompt: "Original prompt",
    status: "completed",
    sessionId: null,
    promptId: null,
    failureCode: null,
    createdAt: "2026-08-14T12:00:00Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function noControls(overrides: Partial<WorkflowNodeControlSet> = {}): WorkflowNodeControlSet {
  return {
    approve: false,
    failRedo: false,
    flipToAgent: false,
    flipToHuman: false,
    addAdhoc: false,
    ...overrides,
  };
}

function buildVm(
  node: Partial<WorkflowRunNodeV2>,
  controls: Partial<WorkflowNodeControlSet> = {},
): WorkflowGraphNodeVM {
  return {
    node: baseNode(node),
    isCurrent: false,
    tone: "muted",
    controls: noControls(controls),
  };
}

function chainSlot(chainIndex: number, title: string): WorkflowGraphSlotVM {
  return {
    chainIndex,
    attempts: [buildVm({ id: `node-${chainIndex}`, chainIndex, title })],
    adhoc: [],
  };
}

function renderView(
  slots: WorkflowGraphSlotVM[],
  options: { selectedNodeRowId?: string | null; needsInput?: ReadonlySet<string> } = {},
) {
  const onSelectNode = vi.fn();
  const { container } = render(
    <WorkflowGraphView
      slots={slots}
      needsInputNodeRowIds={options.needsInput ?? new Set()}
      selectedNodeRowId={options.selectedNodeRowId ?? null}
      onSelectNode={onSelectNode}
    />,
  );
  return { container, onSelectNode };
}

/** The drawn edges: every stroked path in the canvas SVG (the arrow-marker path is filled, not stroked). */
function edgesOf(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("path[stroke]")];
}

describe("WorkflowGraphView", () => {
  it("draws every node as a selectable card on the canvas", () => {
    const { onSelectNode } = renderView([
      chainSlot(0, "Draft questions"),
      chainSlot(1, "Answer them"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Answer them/ }));
    expect(onSelectNode).toHaveBeenCalledWith("node-1");
  });

  it("joins consecutive chain slots with drawn edges and draws none before the first", () => {
    const { container } = renderView([
      chainSlot(0, "Draft questions"),
      chainSlot(1, "Answer them"),
      chainSlot(2, "Propose the design"),
    ]);

    expect(edgesOf(container).length).toBe(2);
  });

  it("draws no edge around a single slot", () => {
    const { container } = renderView([chainSlot(0, "Only step")]);
    expect(edgesOf(container).length).toBe(0);
  });

  it("keeps the edge SVG decorative", () => {
    const { container } = renderView([chainSlot(0, "One"), chainSlot(1, "Two")]);
    for (const edge of edgesOf(container)) {
      expect(edge.closest("svg[aria-hidden]")).not.toBeNull();
    }
  });

  it("keeps a slot's retries inside the slot, with no edge drawn between attempts", () => {
    const { container } = renderView([
      {
        chainIndex: 0,
        attempts: [
          buildVm({ id: "node-a", chainIndex: 0, title: "First attempt", status: "failed" }),
          buildVm({ id: "node-b", chainIndex: 0, title: "Second attempt", kind: "replacement" }),
        ],
        adhoc: [],
      },
    ]);

    expect(screen.getByText("First attempt")).toBeTruthy();
    expect(screen.getByText("Second attempt")).toBeTruthy();
    expect(edgesOf(container).length).toBe(0);
  });

  it("hangs an ad hoc side node off a dashed branch edge", () => {
    const { container } = renderView([
      {
        chainIndex: 0,
        attempts: [buildVm({ id: "node-chain", chainIndex: 0, title: "Anchor" })],
        adhoc: [
          buildVm({
            id: "node-side",
            chainIndex: 0,
            title: "Side errand",
            kind: "adhoc",
            anchorNodeRowId: "node-chain",
          }),
        ],
      },
    ]);

    expect(screen.getByText("Side errand")).toBeTruthy();
    const [edge] = edgesOf(container);
    expect(edge.getAttribute("stroke-dasharray")).toBe("4 4");
  });

  it("still renders a side node whose anchor is not among the slot's attempts", () => {
    const { container } = renderView([
      {
        chainIndex: 0,
        attempts: [buildVm({ id: "node-chain", chainIndex: 0, title: "Anchor" })],
        adhoc: [
          buildVm({
            id: "node-side",
            chainIndex: 0,
            title: "Orphaned errand",
            kind: "adhoc",
            anchorNodeRowId: "node-gone",
          }),
        ],
      },
    ]);

    expect(screen.getByText("Orphaned errand")).toBeTruthy();
    // Its branch edge falls back to the rank's latest attempt.
    expect(edgesOf(container).length).toBe(1);
  });

  it("presses the selected card and no other", () => {
    renderView([chainSlot(0, "One"), chainSlot(1, "Two")], { selectedNodeRowId: "node-0" });

    expect(
      screen.getByRole("button", { name: /One/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /Two/ }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("wears the needs-input mark beside the kind header", () => {
    renderView([chainSlot(0, "Waiting step")], { needsInput: new Set(["node-0"]) });

    expect(screen.getByText("Needs input")).toBeTruthy();
    // The design keeps the prompt line; needs-input rides the header's right.
    expect(screen.getByText("Original prompt")).toBeTruthy();
  });

  it("offers the zoom controls", () => {
    renderView([chainSlot(0, "Only step")]);

    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fit to view" })).toBeTruthy();
  });
});
