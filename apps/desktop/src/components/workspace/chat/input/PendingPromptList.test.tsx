// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { derivePendingPromptQueueRow } from "@proliferate/product-domain/chats/pending-prompts/pending-prompt-queue";
import { PendingPromptList, type PendingPromptListProps } from "./PendingPromptList";

vi.mock("@/hooks/chat/ui/use-pending-prompt-queue", () => ({
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
    expect(props.onReorder).toHaveBeenCalledWith(0, 1);

    fireEvent.keyDown(handles[1]!, { key: "ArrowUp" });
    expect(props.onReorder).toHaveBeenCalledWith(1, 0);
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

    expect(props.onReorder).toHaveBeenNthCalledWith(1, 0, 2);
    expect(props.onReorder).toHaveBeenNthCalledWith(2, 2, 0);
  });
});
