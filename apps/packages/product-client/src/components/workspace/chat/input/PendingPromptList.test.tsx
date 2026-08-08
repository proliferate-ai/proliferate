// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { derivePendingPromptQueueRow } from "#product/domain/chats/pending-prompts/pending-prompt-queue";
import { PendingPromptList, type PendingPromptListProps } from "#product/components/workspace/chat/input/PendingPromptList";

vi.mock("#product/hooks/chat/ui/use-pending-prompt-queue", () => ({
  usePendingPromptQueue: vi.fn(),
}));

const ENTRIES = [
  derivePendingPromptQueueRow({
    seq: 4,
    promptId: "duplicate-id",
    text: "first",
    contentParts: [],
    isBeingEdited: false,
  }),
  derivePendingPromptQueueRow({
    seq: 9,
    promptId: "duplicate-id",
    text: "second",
    contentParts: [],
    isBeingEdited: false,
  }),
];

function renderList(overrides: Partial<PendingPromptListProps> = {}) {
  const props: PendingPromptListProps = {
    entries: ENTRIES,
    steeringSeq: null,
    sessionMaterialized: true,
    queueMutationInFlight: false,
    onBeginEdit: vi.fn(),
    onDelete: vi.fn(),
    onSteer: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  return { ...render(<PendingPromptList {...props} />), props };
}

describe("PendingPromptList", () => {
  afterEach(() => cleanup());

  it("uses native keyboard-operable buttons for reorder handles", () => {
    const { props } = renderList();
    const handles = screen.getAllByRole("button", { name: "Reorder queued message" });

    expect(handles).toHaveLength(2);
    expect(handles[0]?.tagName).toBe("BUTTON");
    expect(handles[0]?.getAttribute("aria-keyshortcuts")).toBe("ArrowUp ArrowDown");

    fireEvent.keyDown(handles[0]!, { key: "ArrowDown" });
    expect(props.onReorder).toHaveBeenCalledWith("seq:4", "seq:9");

    fireEvent.keyDown(handles[1]!, { key: "ArrowUp" });
    expect(props.onReorder).toHaveBeenCalledWith("seq:9", "seq:4");
  });

  it("disables queue actions and drag handles during either queue mutation", () => {
    renderList({ queueMutationInFlight: true });

    expect(screen.queryByRole("button", { name: "Reorder queued message" })).toBeNull();
    const steerButtons = screen.getAllByRole("button", {
      name: "Send next — interrupts the current turn",
    });
    expect(steerButtons).toHaveLength(2);
    expect(steerButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(
      screen.getAllByRole("button", { name: "Edit queued message" })
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
    expect(
      screen.getAllByRole("button", { name: "Delete queued message" })
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
  });

  it("skips local outbox rows during keyboard reorder", () => {
    const localRow = derivePendingPromptQueueRow({
      seq: -1,
      promptId: "local-prompt",
      text: "dispatching locally",
      contentParts: [],
      isBeingEdited: false,
      localOutboxDeliveryState: "dispatching",
    });
    const { props } = renderList({ entries: [ENTRIES[0]!, localRow, ENTRIES[1]!] });
    const handles = screen.getAllByRole("button", { name: "Reorder queued message" });

    fireEvent.keyDown(handles[0]!, { key: "ArrowDown" });
    fireEvent.keyDown(handles[1]!, { key: "ArrowUp" });

    expect(props.onReorder).toHaveBeenNthCalledWith(1, "seq:4", "seq:9");
    expect(props.onReorder).toHaveBeenNthCalledWith(2, "seq:9", "seq:4");
  });

  it("addresses the dragged human row by key when agent updates share the queue", () => {
    // The regression this pins: the list renders only the human rows, so the
    // second human message is at rendered index 1 but queue index 2. An index
    // handed to the queue would move the FIRST human message instead — and
    // move it past an agent-queued update the human may not touch.
    const agentWake = derivePendingPromptQueueRow({
      seq: 7,
      promptId: null,
      text: "",
      contentParts: [],
      isBeingEdited: false,
      promptProvenance: {
        type: "subagentWake",
        completionId: "completion-1",
        sessionLinkId: "link-1",
        label: "Schema audit",
      },
    });
    const { props } = renderList({ entries: [agentWake, ENTRIES[0]!, ENTRIES[1]!] });
    const handles = screen.getAllByRole("button", { name: "Reorder queued message" });

    expect(handles).toHaveLength(2);
    fireEvent.keyDown(handles[1]!, { key: "ArrowUp" });

    expect(props.onReorder).toHaveBeenCalledWith("seq:9", "seq:4");
    expect(props.onReorder).not.toHaveBeenCalledWith("seq:7", expect.anything());
  });
});
