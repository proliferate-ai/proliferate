// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assistantItem,
  terminalItem,
  toolItem,
  turnRecord,
  userItem,
} from "#product/domain/chats/transcript/transcript-presentation-test-fixtures";
import { buildTurnPresentation } from "#product/domain/chats/transcript/transcript-presentation";
import {
  constrainTurnItemSequencePresentation,
  resolveTurnItemFrontierBlockKey,
  shouldRenderCompletedArtifactCards,
  TurnItemSequence,
} from "#product/components/workspace/chat/transcript/TurnItemSequence";
import { CompletedHistorySequence } from "#product/components/workspace/chat/transcript/TranscriptTurnChrome";
import { resolveLeadingNonUserMessageBlockKey } from "#product/components/workspace/chat/transcript/TurnWorkspaceReceiptSlot";
import type { TurnPresentation } from "#product/domain/chats/transcript/transcript-presentation";

let pendingAnimationFrames: FrameRequestCallback[];

function flushAnimationFrame() {
  act(() => {
    const frames = pendingAnimationFrames.splice(0);
    for (const frame of frames) frame(0);
  });
}

vi.mock("./TranscriptTreeNode", () => ({
  TranscriptTreeNode: ({ itemId }: { itemId: string }) => (
    <div data-rendered-transcript-item={itemId}>{itemId}</div>
  ),
}));

beforeEach(() => {
  pendingAnimationFrames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pendingAnimationFrames.push(callback);
    return pendingAnimationFrames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CompletedHistorySequence", () => {
  it("restores the full conversation gap between top-level history items", () => {
    const { container } = render(
      <CompletedHistorySequence>
        <div>Assistant prose</div>
        <div>Collapsed search action</div>
        <div>More assistant prose</div>
      </CompletedHistorySequence>,
    );

    const sequence = container.querySelector("[data-completed-history-sequence]");
    // [CHAT-04] RULED: the shared turn rhythm is the 16px
    // --spacing-transcript-turn token (TURN_ITEM_GAP_CLASS), not a raw gap-4.
    expect(sequence?.className).toContain("flex flex-col gap-transcript-turn");
    expect(sequence?.className).not.toContain("space-y-1");
  });

  it("removes only the completed-work border box and preserves ledger detail chrome", async () => {
    const user = userEvent.setup();
    const transcript = createTranscriptState("session-1");
    const turn = turnRecord(["command", "command-2", "answer"], "2026-04-04T00:00:10Z");
    transcript.itemsById = {
      command: terminalItem("command", turn.turnId, 1, "printf proof"),
      "command-2": terminalItem("command-2", turn.turnId, 2, "printf more"),
      answer: assistantItem("answer", turn.turnId, 3),
    };
    const { container } = renderTurnItemSequence({ turn, transcript });

    const completedWorkDisclosure = screen.getByRole("button", {
      name: /Worked for 10s/,
    });
    expect(completedWorkDisclosure.className).toContain("border-0");
    expect(completedWorkDisclosure.className).toContain("rounded-none");
    expect(completedWorkDisclosure.className).not.toMatch(/(?:^|\s)border(?:\s|$)/);
    expect(completedWorkDisclosure.className).not.toContain("rounded-md");

    await user.click(completedWorkDisclosure);
    flushAnimationFrame();
    const sequence = container.querySelector<HTMLElement>("[data-completed-history-sequence]");
    expect(sequence).not.toBeNull();

    const actionSummary = within(sequence!).getByRole("button", { expanded: false });
    await user.click(actionSummary);
    flushAnimationFrame();
    const ledger = container.querySelector<HTMLElement>("[data-collapsed-actions-ledger]");
    expect(ledger).not.toBeNull();
    expect(ledger?.className).toContain("max-h-56");
    expect(ledger?.className).toContain("overflow-y-auto");
    expect(ledger?.className).toContain("overflow-x-hidden");

    const commandDisclosure = within(ledger!).getAllByRole("button", { expanded: false })[0]!;
    await user.click(commandDisclosure);
    // The nested panel is ToolActionDetailsPanel now, which is where the three
    // inline copies of this shell folded — hence the shared panel's
    // code-block-card styling.
    const nestedDetailPanel = Array.from(ledger!.querySelectorAll<HTMLElement>("div"))
      .find((node) =>
        node.className.includes("overflow-clip")
        && node.className.includes("rounded-lg")
        && node.className.includes("bg-[var(--color-code-block-background")
      );
    expect(nestedDetailPanel).not.toBeUndefined();
    expect(nestedDetailPanel?.className).toMatch(/(?:^|\s)border(?:\s|$)/);
    expect(nestedDetailPanel?.className).toContain("rounded-lg");
  });
});

describe("completion-only frontier prelude", () => {
  it("keeps a tool-only completion summary as the frontier", () => {
    const transcript = createTranscriptState("session-1");
    const turn = turnRecord(["command"], "2026-04-04T00:00:10Z");
    transcript.itemsById = {
      command: toolItem("command", turn.turnId, 1, "terminal", "completed"),
    };

    expect(resolveTurnItemFrontierBlockKey(buildTurnPresentation(turn, transcript)))
      .toBe("collapsed-actions-command");
  });

  it("renders full-turn artifact cards only in the chunk that owns final prose", () => {
    const transcript = createTranscriptState("session-1");
    const turn = turnRecord(["search", "answer"], "2026-04-04T00:00:10Z");
    transcript.itemsById = {
      search: toolItem("search", turn.turnId, 1, "search", "completed"),
      answer: assistantItem("answer", turn.turnId, 2),
    };
    const fullPresentation = buildTurnPresentation(turn, transcript);
    const leadingChunk = {
      ...fullPresentation,
      displayBlocks: fullPresentation.displayBlocks.filter(
        (block) => block.kind !== "item" || block.itemId !== "answer",
      ),
    };

    expect(shouldRenderCompletedArtifactCards({
      completedArtifactCount: 1,
      presentation: leadingChunk,
      tailAssistantProseRootId: "answer",
      showCompletedArtifactFallback: false,
    })).toBe(false);
    expect(shouldRenderCompletedArtifactCards({
      completedArtifactCount: 1,
      presentation: fullPresentation,
      tailAssistantProseRootId: "answer",
      showCompletedArtifactFallback: true,
    })).toBe(true);
  });
});

describe("completed-work transition", () => {
  it("fades the collapsed summary only on a mounted live-to-complete handoff", () => {
    const transcript = createTranscriptState("session-1");
    const liveTurn = turnRecord(["read"]);
    transcript.itemsById = {
      read: toolItem("read", liveTurn.turnId, 1, "file_read", "in_progress"),
    };
    const { container, rerender } = renderTurnItemSequence({
      turn: liveTurn,
      transcript,
    });

    const completedTurn = turnRecord(["read", "answer"], "2026-04-04T00:00:10Z");
    transcript.itemsById.read = toolItem("read", completedTurn.turnId, 1, "file_read", "completed");
    transcript.itemsById.answer = assistantItem("answer", completedTurn.turnId, 2);
    rerender(turnItemSequence({ turn: completedTurn, transcript }));

    const transition = container.querySelector("[data-completed-work-transition='true']");
    expect(transition?.className).toContain("motion-safe:animate-status-crossfade");
    expect(transition?.className).not.toContain("height");

    rerender(turnItemSequence({ turn: completedTurn, transcript }));
    expect(container.querySelector("[data-completed-work-transition='true']"))
      .toBe(transition);

    cleanup();
    const hydrated = renderTurnItemSequence({ turn: completedTurn, transcript });
    expect(hydrated.container.querySelector("[data-completed-work-transition]")).toBeNull();
  });
});

describe("assistant visual frontier", () => {
  it("withholds following thinking and tool blocks until prose settles", () => {
    const presentation = {
      rootIds: ["answer", "thought", "command"],
      childrenByParentId: new Map(),
      displayBlocks: [
        { kind: "item", itemId: "answer" },
        { kind: "item", itemId: "thought" },
        { kind: "collapsed_actions", blockId: "command-command", itemIds: ["command"] },
      ],
      finalAssistantItemId: null,
      completedHistoryRootIds: [],
      completedHistorySummary: null,
    } as TurnPresentation;

    expect(
      constrainTurnItemSequencePresentation(presentation, "answer").displayBlocks,
    ).toEqual([{ kind: "item", itemId: "answer" }]);
    expect(constrainTurnItemSequencePresentation(presentation, null)).toBe(presentation);
  });
});

describe("workspace receipt hosting", () => {
  it("folds the receipt inside the completed-history disclosure, hidden until expanded", async () => {
    const user = userEvent.setup();
    const transcript = createTranscriptState("session-1");
    const turn = turnRecord(["prompt", "command", "answer"], "2026-04-04T00:00:10Z");
    transcript.itemsById = {
      prompt: userItem("prompt", turn.turnId, 0),
      command: terminalItem("command", turn.turnId, 1, "printf proof"),
      answer: assistantItem("answer", turn.turnId, 2),
    };
    const receiptMarker = <div data-testid="receipt-marker">Worktree created</div>;
    const { container } = renderTurnItemSequence({ turn, transcript, workspaceReceipt: receiptMarker });

    // Collapsed: the disclosure exists, but the receipt (like the rest of
    // the history) is not in the DOM yet.
    const disclosure = screen.getByRole("button", { name: /Worked for 10s/ });
    expect(screen.queryByTestId("receipt-marker")).toBeNull();

    await user.click(disclosure);

    const sequence = container.querySelector<HTMLElement>("[data-completed-history-sequence]");
    expect(sequence).not.toBeNull();
    const marker = within(sequence!).getByTestId("receipt-marker");
    // First child inside the disclosure's children.
    expect(sequence!.firstElementChild).toBe(marker);
  });

  it("renders the receipt inline before the first non-user-message block while streaming", () => {
    const transcript = createTranscriptState("session-1");
    const turn = turnRecord(["prompt", "command"]);
    transcript.itemsById = {
      prompt: userItem("prompt", turn.turnId, 0),
      command: toolItem("command", turn.turnId, 1, "terminal", "in_progress"),
    };
    const receiptMarker = <div data-testid="receipt-marker">Worktree created</div>;
    const { container } = renderTurnItemSequence({ turn, transcript, workspaceReceipt: receiptMarker });

    const marker = screen.getByTestId("receipt-marker");
    expect(marker).not.toBeNull();
    // Renders before the tool block, after the leading user-message block —
    // never inside the (nonexistent, since the turn isn't complete) disclosure.
    expect(container.querySelector("[data-completed-history-sequence]")).toBeNull();
    const promptNode = screen.getByText("prompt");
    expect(
      promptNode.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the receipt after all blocks when every block so far is a user message", () => {
    const transcript = createTranscriptState("session-1");
    const turn = turnRecord(["prompt"]);
    transcript.itemsById = {
      prompt: userItem("prompt", turn.turnId, 0),
    };
    expect(resolveLeadingNonUserMessageBlockKey(buildTurnPresentation(turn, transcript), transcript))
      .toBeNull();

    const receiptMarker = <div data-testid="receipt-marker">Worktree created</div>;
    renderTurnItemSequence({ turn, transcript, workspaceReceipt: receiptMarker });
    expect(screen.getByTestId("receipt-marker")).not.toBeNull();
  });

  it("hosts the receipt in a synthetic Worked-for disclosure when the completed turn has no history of its own", async () => {
    const user = userEvent.setup();
    const transcript = createTranscriptState("session-1");
    // Prose-only completed turn: no tool calls/thinking, so
    // completedHistorySummary is null and there is no real disclosure.
    const turn = turnRecord(["prompt", "answer"], "2026-04-04T00:00:10Z");
    transcript.itemsById = {
      prompt: userItem("prompt", turn.turnId, 0),
      answer: assistantItem("answer", turn.turnId, 1),
    };
    const receiptMarker = <div data-testid="receipt-marker">Worktree created</div>;
    const { container } = renderTurnItemSequence({ turn, transcript, workspaceReceipt: receiptMarker });

    // A "Worked for Ns" disclosure trigger exists even though this turn has
    // no other tool-call/thinking history — the receipt itself is the work.
    const disclosure = screen.getByRole("button", { name: /Worked for 10s/ });
    expect(disclosure).not.toBeNull();
    // Collapsed: the receipt is hidden until expanded, like folded history.
    expect(screen.queryByTestId("receipt-marker")).toBeNull();
    // The assistant prose renders outside the disclosure regardless.
    expect(screen.getByText("answer")).not.toBeNull();

    await user.click(disclosure);

    const sequence = container.querySelector<HTMLElement>("[data-completed-history-sequence]");
    expect(sequence).not.toBeNull();
    const marker = within(sequence!).getByTestId("receipt-marker");
    expect(marker).not.toBeNull();
  });

  it("still folds into the one real disclosure when the completed turn has its own history, never a second one", async () => {
    const user = userEvent.setup();
    const transcript = createTranscriptState("session-1");
    const turn = turnRecord(["prompt", "command", "answer"], "2026-04-04T00:00:10Z");
    transcript.itemsById = {
      prompt: userItem("prompt", turn.turnId, 0),
      command: terminalItem("command", turn.turnId, 1, "printf proof"),
      answer: assistantItem("answer", turn.turnId, 2),
    };
    const receiptMarker = <div data-testid="receipt-marker">Worktree created</div>;
    renderTurnItemSequence({ turn, transcript, workspaceReceipt: receiptMarker });

    const disclosures = screen.getAllByRole("button", { name: /Worked for 10s/ });
    expect(disclosures).toHaveLength(1);

    await user.click(disclosures[0]!);
    expect(screen.getByTestId("receipt-marker")).not.toBeNull();
  });
});

function renderTurnItemSequence({
  turn,
  transcript,
  workspaceReceipt,
}: {
  turn: ReturnType<typeof turnRecord>;
  transcript: ReturnType<typeof createTranscriptState>;
  workspaceReceipt?: ReactNode;
}) {
  return render(turnItemSequence({ turn, transcript, workspaceReceipt }));
}

function turnItemSequence({
  turn,
  transcript,
  workspaceReceipt,
}: {
  turn: ReturnType<typeof turnRecord>;
  transcript: ReturnType<typeof createTranscriptState>;
  workspaceReceipt?: ReactNode;
}) {
  const presentation = buildTurnPresentation(turn, transcript);
  return (
    <TurnItemSequence
      turn={turn}
      transcript={transcript}
      isTurnComplete={turn.completedAt !== null}
      presentation={presentation}
      autoFollowCollapsedActionBlockId={null}
      tailAssistantProseRootId={presentation.finalAssistantItemId}
      completedHistoryLabel={null}
      animateActivityEntry={false}
      animateAssistantRevealItemId={null}
      showCompletedArtifactFallback={false}
      workspaceId={null}
      onOpenArtifact={vi.fn()}
      workspaceReceipt={workspaceReceipt}
    />
  );
}
