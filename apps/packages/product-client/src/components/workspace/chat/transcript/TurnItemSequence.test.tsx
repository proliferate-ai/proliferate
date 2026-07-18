// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assistantItem,
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

afterEach(cleanup);

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
