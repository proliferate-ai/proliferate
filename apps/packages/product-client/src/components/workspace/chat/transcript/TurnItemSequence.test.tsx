// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assistantItem,
  terminalItem,
  toolItem,
  turnRecord,
} from "@proliferate/product-domain/chats/transcript/transcript-presentation-test-fixtures";
import { buildTurnPresentation } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import {
  CompletedHistorySequence,
  constrainTurnItemSequencePresentation,
  resolveTurnItemFrontierBlockKey,
  shouldRenderCompletedArtifactCards,
  TurnItemSequence,
} from "#product/components/workspace/chat/transcript/TurnItemSequence";
import type { TurnPresentation } from "@proliferate/product-domain/chats/transcript/transcript-presentation";

vi.mock("./TranscriptTreeNode", () => ({
  TranscriptTreeNode: ({ itemId }: { itemId: string }) => (
    <div data-rendered-transcript-item={itemId}>{itemId}</div>
  ),
}));

beforeEach(() => {
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
    expect(sequence?.className).toContain("flex flex-col gap-4");
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
    const sequence = container.querySelector<HTMLElement>("[data-completed-history-sequence]");
    expect(sequence).not.toBeNull();

    const actionSummary = within(sequence!).getByRole("button", { expanded: false });
    await user.click(actionSummary);
    const ledger = container.querySelector<HTMLElement>("[data-collapsed-actions-ledger]");
    expect(ledger).not.toBeNull();
    expect(ledger?.className).toContain("max-h-56");
    expect(ledger?.className).toContain("overflow-y-auto");
    expect(ledger?.className).toContain("overflow-x-hidden");

    const commandDisclosure = within(ledger!).getAllByRole("button", { expanded: false })[0]!;
    await user.click(commandDisclosure);
    const nestedDetailPanel = Array.from(ledger!.querySelectorAll<HTMLElement>("div"))
      .find((node) =>
        node.className.includes("overflow-hidden")
        && node.className.includes("rounded-lg")
        && node.className.includes("border-border/60")
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

function renderTurnItemSequence({
  turn,
  transcript,
}: {
  turn: ReturnType<typeof turnRecord>;
  transcript: ReturnType<typeof createTranscriptState>;
}) {
  return render(turnItemSequence({ turn, transcript }));
}

function turnItemSequence({
  turn,
  transcript,
}: {
  turn: ReturnType<typeof turnRecord>;
  transcript: ReturnType<typeof createTranscriptState>;
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
    />
  );
}
