// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunDocV2, WorkflowRunNodeV2 } from "@anyharness/sdk";
import { WorkflowDocsList } from "./WorkflowDocsList";

afterEach(cleanup);

function buildDoc(overrides: Partial<WorkflowRunDocV2> = {}): WorkflowRunDocV2 {
  return {
    id: "doc-1",
    runId: "run-1",
    slug: "research-findings",
    filename: "03-research-findings.md",
    producingNodeRowId: "node-1",
    seededFromTemplate: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildNode(overrides: Partial<WorkflowRunNodeV2> = {}): WorkflowRunNodeV2 {
  return {
    id: "node-1",
    runId: "run-1",
    definitionNodeId: "def-node-1",
    kind: "defined",
    nodeType: "agent",
    replacesNodeRowId: null,
    anchorNodeRowId: null,
    chainIndex: 0,
    title: "Research findings",
    prompt: "Research the thing",
    status: "completed",
    sessionId: null,
    promptId: null,
    failureCode: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("WorkflowDocsList", () => {
  it("renders nothing for an empty docs array", () => {
    const { container } = render(
      <WorkflowDocsList docs={[]} nodesById={new Map()} onOpenDoc={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("passes the exact doc to onOpenDoc on row click", () => {
    const doc = buildDoc();
    const node = buildNode();
    const onOpenDoc = vi.fn();
    render(
      <WorkflowDocsList
        docs={[doc]}
        nodesById={new Map([[node.id, node]])}
        onOpenDoc={onOpenDoc}
      />,
    );

    fireEvent.click(screen.getByText(doc.filename));

    expect(onOpenDoc).toHaveBeenCalledTimes(1);
    expect(onOpenDoc).toHaveBeenCalledWith(doc);
  });

  it("renders the producing node's title when it resolves", () => {
    const doc = buildDoc({ producingNodeRowId: "node-1" });
    const node = buildNode({ id: "node-1", title: "Research findings" });
    render(
      <WorkflowDocsList
        docs={[doc]}
        nodesById={new Map([[node.id, node]])}
        onOpenDoc={() => {}}
      />,
    );

    expect(screen.getByText("Research findings")).toBeTruthy();
  });

  it("NEGATIVE CONTROL: still renders the filename row when producingNodeRowId matches no node", () => {
    const doc = buildDoc({ producingNodeRowId: "missing-node" });
    render(
      <WorkflowDocsList docs={[doc]} nodesById={new Map()} onOpenDoc={() => {}} />,
    );

    expect(screen.getByText(doc.filename)).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("still renders the filename row when the doc has no producing node at all", () => {
    const doc = buildDoc({ producingNodeRowId: null });
    render(
      <WorkflowDocsList docs={[doc]} nodesById={new Map()} onOpenDoc={() => {}} />,
    );

    expect(screen.getByText(doc.filename)).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });
});
