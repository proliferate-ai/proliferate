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

function renderView(slots: WorkflowGraphSlotVM[]) {
  const onFocusSession = vi.fn();
  const onApprove = vi.fn();
  const onFailRedo = vi.fn();
  const onFlipType = vi.fn();
  const onAddAdhoc = vi.fn();
  const { container } = render(
    <WorkflowGraphView
      slots={slots}
      needsInputNodeRowIds={new Set()}
      busy={false}
      onFocusSession={onFocusSession}
      onApprove={onApprove}
      onFailRedo={onFailRedo}
      onFlipType={onFlipType}
      onAddAdhoc={onAddAdhoc}
    />,
  );
  return { container, onFocusSession, onApprove, onFailRedo, onFlipType, onAddAdhoc };
}

/**
 * The drawn edge's hairline. The graph is the only place in the view that
 * draws a `w-px` segment (the cards have none), so counting them counts
 * edges.
 */
function edgesOf(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll(".w-px.bg-border");
}

describe("WorkflowGraphView", () => {
  it("joins consecutive chain slots with drawn edges and draws none before the first", () => {
    const { container } = renderView([
      chainSlot(0, "Draft questions"),
      chainSlot(1, "Answer them"),
      chainSlot(2, "Propose the design"),
    ]);

    expect(edgesOf(container).length).toBe(2);
    // Order: the first rendered element is a card, never an edge.
    const first = container.firstElementChild?.firstElementChild;
    expect(first?.getAttribute("aria-hidden")).toBeNull();
  });

  it("draws no edge around a single slot", () => {
    const { container } = renderView([chainSlot(0, "Only step")]);
    expect(edgesOf(container).length).toBe(0);
  });

  it("marks every drawn edge decorative", () => {
    const { container } = renderView([chainSlot(0, "One"), chainSlot(1, "Two")]);
    for (const edge of edgesOf(container)) {
      expect(edge.closest("[aria-hidden]")).not.toBeNull();
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

    expect(screen.getByText("01 · First attempt")).toBeTruthy();
    expect(screen.getByText("01 · Second attempt")).toBeTruthy();
    expect(edgesOf(container).length).toBe(0);
  });

  it("hangs ad hoc side nodes off a branch rail under their anchor slot", () => {
    renderView([
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

    const sideTitle = screen.getByText("01 · Side errand");
    expect(sideTitle.closest(".border-l")).not.toBeNull();
    const chainTitle = screen.getByText("01 · Anchor");
    expect(chainTitle.closest(".border-l")).toBeNull();
  });

  it("passes card callbacks through untouched", () => {
    const { onApprove } = renderView([
      {
        chainIndex: 0,
        attempts: [
          buildVm(
            { id: "node-gate", chainIndex: 0, title: "Approve the design", status: "awaiting_human" },
            { approve: true },
          ),
        ],
        adhoc: [],
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledWith("node-gate");
  });
});
