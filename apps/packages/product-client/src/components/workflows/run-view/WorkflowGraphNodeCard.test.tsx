// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { WorkflowRunNodeV2 } from "@anyharness/sdk";
import type {
  WorkflowGraphNodeVM,
  WorkflowNodeControlSet,
  WorkflowNodeTone,
} from "#product/domain/workflows/run-view-model";
import {
  WorkflowGraphNodeCard,
  type WorkflowGraphNodeCardProps,
} from "#product/components/workflows/run-view/WorkflowGraphNodeCard";

// Radix Dialog (ModalShell, used by both node-card dialogs) touches DOM APIs
// jsdom does not implement.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

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
    chainIndex: 2,
    title: "Research the topic",
    prompt: "Original prompt",
    status: "awaiting_human",
    sessionId: null,
    promptId: null,
    failureCode: null,
    createdAt: "2026-08-14T12:00:00Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function baseControls(overrides: Partial<WorkflowNodeControlSet> = {}): WorkflowNodeControlSet {
  return {
    approve: false,
    failRedo: false,
    flipToAgent: false,
    flipToHuman: false,
    addAdhoc: false,
    ...overrides,
  };
}

function buildVm(options: {
  node?: Partial<WorkflowRunNodeV2>;
  controls?: Partial<WorkflowNodeControlSet>;
  isCurrent?: boolean;
  tone?: WorkflowNodeTone;
} = {}): WorkflowGraphNodeVM {
  return {
    node: baseNode(options.node),
    isCurrent: options.isCurrent ?? false,
    tone: options.tone ?? "info",
    controls: baseControls(options.controls),
  };
}

function renderCard(props: Partial<WorkflowGraphNodeCardProps> & { vm: WorkflowGraphNodeVM }) {
  const onFocusSession = vi.fn();
  const onApprove = vi.fn();
  const onFailRedo = vi.fn();
  const onFlipType = vi.fn();
  const onAddAdhoc = vi.fn();
  const { container } = render(
    <WorkflowGraphNodeCard
      onFocusSession={onFocusSession}
      onApprove={onApprove}
      onFailRedo={onFailRedo}
      onFlipType={onFlipType}
      onAddAdhoc={onAddAdhoc}
      {...props}
    />,
  );
  return { container, onFocusSession, onApprove, onFailRedo, onFlipType, onAddAdhoc };
}

/** The StatusDot the card draws as the row's leading glyph. */
function statusDotOf(container: HTMLElement): HTMLElement {
  const dot = container.querySelector(".icon-status.rounded-full");
  if (!(dot instanceof HTMLElement)) {
    throw new Error("no status dot in the card");
  }
  return dot;
}

function rowOf(text: string): HTMLElement {
  const element = screen.getByText(text).closest("[data-selected]");
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no roster row around ${text}`);
  }
  return element;
}

describe("WorkflowGraphNodeCard", () => {
  it("renders exactly the controls its vm.controls booleans allow", () => {
    renderCard({
      vm: buildVm({ controls: { approve: true, failRedo: true, flipToAgent: true } }),
    });

    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fail & redo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make agent" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Make gate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add side node" })).toBeNull();
  });

  it("negative control: a completed node with only addAdhoc shows no approve/redo/flip controls", () => {
    renderCard({
      vm: buildVm({
        node: { status: "completed" },
        controls: { addAdhoc: true },
      }),
    });

    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fail & redo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Make agent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Make gate" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add side node" })).toBeTruthy();
  });

  it("fires onFocusSession when the card body is clicked", () => {
    const { onFocusSession } = renderCard({ vm: buildVm() });

    fireEvent.click(rowOf("03 · Research the topic"));

    expect(onFocusSession).toHaveBeenCalledWith("node-1");
  });

  it("fail-redo confirms with undefined when the prompt is untouched", () => {
    const { onFailRedo } = renderCard({
      vm: buildVm({ controls: { failRedo: true } }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Fail & redo" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Prompt")).toHaveProperty("value", "Original prompt");
    fireEvent.click(within(dialog).getByRole("button", { name: "Fail & redo" }));

    expect(onFailRedo).toHaveBeenCalledWith("node-1", undefined);
  });

  it("fail-redo confirms with the edited prompt when it was changed", () => {
    const { onFailRedo } = renderCard({
      vm: buildVm({ controls: { failRedo: true } }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Fail & redo" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Prompt"), {
      target: { value: "Edited prompt" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Fail & redo" }));

    expect(onFailRedo).toHaveBeenCalledWith("node-1", "Edited prompt");
  });

  it("disables the ad hoc confirm on a blank prompt, enables it once one is entered", () => {
    const { onAddAdhoc } = renderCard({
      vm: buildVm({ controls: { addAdhoc: true } }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Add side node" }));
    const dialog = screen.getByRole("dialog");
    const confirm = () => within(dialog).getByRole("button", { name: "Add side node" });
    expect(confirm()).toHaveProperty("disabled", true);

    fireEvent.change(within(dialog).getByLabelText("Prompt"), { target: { value: "   " } });
    expect(confirm()).toHaveProperty("disabled", true);

    fireEvent.change(within(dialog).getByLabelText("Prompt"), {
      target: { value: "Do the side thing" },
    });
    expect(confirm()).toHaveProperty("disabled", false);

    fireEvent.click(confirm());
    expect(onAddAdhoc).toHaveBeenCalledWith("node-1", "Do the side thing");
  });

  it("disables every rendered control while busy", () => {
    renderCard({
      busy: true,
      vm: buildVm({
        controls: {
          approve: true,
          failRedo: true,
          flipToAgent: true,
          flipToHuman: true,
          addAdhoc: true,
        },
      }),
    });

    for (const name of ["Approve", "Fail & redo", "Make agent", "Make gate", "Add side node"]) {
      expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
    }
  });

  it("shows the needs-input badge only when the needsInput prop is set", () => {
    renderCard({ vm: buildVm(), needsInput: true });
    expect(screen.getByText("Needs input")).toBeTruthy();
  });

  it("omits the needs-input badge when the needsInput prop is unset", () => {
    renderCard({ vm: buildVm() });
    expect(screen.queryByText("Needs input")).toBeNull();
  });

  it("paints the dot from the vm's tone", () => {
    const { container } = renderCard({ vm: buildVm({ tone: "danger" }) });
    expect(statusDotOf(container).className).toContain("bg-destructive");
  });

  // A tone outside the closed set reaches StatusDot's own unguarded tone map,
  // where an undefined entry throws mid-render; the client mounts one root
  // AppErrorBoundary, so that throw takes the whole app to crash recovery. The
  // card floors it at muted instead.
  it("renders a tone outside the union as a muted dot instead of throwing", () => {
    const unknownTone = "verifying" as WorkflowNodeTone;
    const { container } = renderCard({ vm: buildVm({ tone: unknownTone }) });

    expect(screen.getByText("03 · Research the topic")).toBeTruthy();
    expect(statusDotOf(container).className).toContain("bg-muted-foreground");
  });

  // The hairline over the controls row belongs to Card's footer slot, not to a
  // hand-drawn border on a div inside the body (which had drifted to a
  // border-border/60 token nothing else in the card uses).
  it("puts the controls row in Card's footer slot, hairline and all", () => {
    const { container } = renderCard({
      vm: buildVm({ controls: { approve: true } }),
    });

    const footer = screen.getByRole("button", { name: "Approve" }).parentElement?.parentElement;
    expect(footer?.className).toContain("border-t");
    expect(footer?.className).toContain("border-border");
    expect(container.innerHTML).not.toContain("border-border/60");
  });

  it("draws no footer hairline on a card with no controls", () => {
    const { container } = renderCard({ vm: buildVm() });
    expect(container.querySelector(".border-t")).toBeNull();
  });

  it("gives the current node's title extra weight (structure, not color) instead of the rest", () => {
    renderCard({ vm: buildVm({ isCurrent: true }) });
    expect(screen.getByText("03 · Research the topic").className).toContain("font-semibold");

    cleanup();
    renderCard({ vm: buildVm({ isCurrent: false }) });
    expect(screen.getByText("03 · Research the topic").className).not.toContain("font-semibold");
  });
});
