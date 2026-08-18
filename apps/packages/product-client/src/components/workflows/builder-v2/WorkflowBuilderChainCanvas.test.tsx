// @vitest-environment jsdom

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import type { WorkflowGraphNodePlacement } from "#product/domain/workflows/graph-layout";
import { WorkflowBuilderChainCanvas } from "#product/components/workflows/builder-v2/WorkflowBuilderChainCanvas";

const NODES: WorkflowNodeV2[] = [
  { id: "research", type: "agent", title: "Research", prompt: "Investigate." },
  { id: "review", type: "human_in_loop", title: "Review", prompt: "Check it." },
];

afterEach(() => {
  cleanup();
});

describe("WorkflowBuilderChainCanvas placement", () => {
  it("moves a card under the pointer and takes its wire with it", () => {
    render(<PlacementHarness />);
    const card = screen.getByRole("button", { name: /^01AgentResearch/ });
    const wire = () => screen.getByLabelText("Remove connection from research to review");
    const wireBefore = wire().getAttribute("style");

    fireEvent.pointerDown(card, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 220, clientY: 140 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 220, clientY: 140 });

    // The canvas draws at zoom 1 with no measured viewport, so screen pixels
    // are content units here: the card leaves its rank (0, 152) by the
    // pointer's own delta.
    expect(cardPlacement(card)).toEqual({ left: "120px", top: "192px" });
    // Edges are derived from placements, so the wire between the two cards
    // must have been redrawn rather than left behind.
    expect(wire().getAttribute("style")).not.toBe(wireBefore);
  });

  it("keeps a press that barely moves a click rather than a move", () => {
    const onSelectNode = vi.fn();
    render(<PlacementHarness onSelectNode={onSelectNode} />);
    const card = screen.getByRole("button", { name: /^01AgentResearch/ });

    fireEvent.pointerDown(card, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 101, clientY: 101 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 101, clientY: 101 });
    fireEvent.click(card);

    expect(cardPlacement(card)).toEqual({ left: "0px", top: "152px" });
    expect(onSelectNode).toHaveBeenCalledWith("research");
  });

  it("nudges a focused card with the arrow keys", () => {
    render(<PlacementHarness />);
    const card = screen.getByRole("button", { name: /^01AgentResearch/ });

    fireEvent.keyDown(card, { key: "ArrowRight" });
    fireEvent.keyDown(card, { key: "ArrowDown" });

    expect(cardPlacement(card)).toEqual({ left: "22px", top: "174px" });
  });

  it("moves the structural Input card too", () => {
    render(<PlacementHarness />);
    const input = screen.getByRole("button", { name: /Trigger payload/ });

    fireEvent.pointerDown(input, { pointerId: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(input, { pointerId: 2, clientX: 40, clientY: 0 });
    fireEvent.pointerUp(input, { pointerId: 2, clientX: 40, clientY: 0 });

    expect(cardPlacement(input)).toEqual({ left: "40px", top: "0px" });
  });

  it("leaves a card where it is while the builder is saving", () => {
    render(<PlacementHarness disabled />);
    const card = screen.getByRole("button", { name: /^01AgentResearch/ });

    fireEvent.pointerDown(card, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 220, clientY: 140 });
    fireEvent.keyDown(card, { key: "ArrowRight" });

    expect(cardPlacement(card)).toEqual({ left: "0px", top: "152px" });
  });
});

/** The card's own absolutely-positioned wrapper carries the placement. */
function cardPlacement(card: HTMLElement): { left: string; top: string } {
  const { style } = card.parentElement as HTMLElement;
  return { left: style.left, top: style.top };
}

function PlacementHarness({
  disabled = false,
  onSelectNode = () => {},
}: {
  disabled?: boolean;
  onSelectNode?: (nodeId: string) => void;
}) {
  const [placements, setPlacements] = useState<Record<string, WorkflowGraphNodePlacement>>({});
  return (
    <WorkflowBuilderChainCanvas
      nodes={NODES}
      edges={[{ from: "research", to: "review" }]}
      inputConnectedTo="research"
      harnesses={[]}
      selectedNodeId={null}
      inputSelected={false}
      issueNodeIds={new Set()}
      nodePlacements={placements}
      disabled={disabled}
      onSelectNode={onSelectNode}
      onSelectInput={() => {}}
      onConnectNodes={() => {}}
      onConnectInput={() => {}}
      onRemoveEdge={() => {}}
      onDisconnectInput={() => {}}
      onMoveNode={(key, placement) =>
        setPlacements((current) => ({ ...current, [key]: placement }))}
    />
  );
}
