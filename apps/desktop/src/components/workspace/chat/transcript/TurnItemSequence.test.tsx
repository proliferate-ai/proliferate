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
  TurnItemSequence,
  resolveTurnItemFrontierBlockKey,
  shouldRenderCompletedArtifactCards,
} from "./TurnItemSequence";

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
  it("mounts late completion UI before final prose so the prose stays anchored", () => {
    const transcript = createTranscriptState("session-1");
    const turn = turnRecord(["search", "answer"], "2026-04-04T00:00:10Z");
    transcript.itemsById = {
      search: toolItem("search", turn.turnId, 1, "search", "completed"),
      answer: assistantItem("answer", turn.turnId, 2),
    };
    const presentation = buildTurnPresentation(turn, transcript);

    const { container } = render(
      <TurnItemSequence
        turn={turn}
        transcript={transcript}
        isTurnComplete
        presentation={presentation}
        tailAssistantProseRootId="answer"
        animateActivityEntry={false}
        showCompletedArtifactFallback
        workspaceId={null}
        onOpenArtifact={() => {}}
        beforeFrontier={<div data-late-diff-panel>Edited files</div>}
      />,
    );

    const prelude = container.querySelector("[data-turn-frontier-prelude]");
    const preludeGroup = container.querySelector("[data-completed-work-content]")
      ?? container.querySelector("[data-turn-frontier-prelude-group]");
    const workContainer = preludeGroup?.hasAttribute("data-completed-work-content")
      ? preludeGroup.parentElement
      : preludeGroup;
    const divider = container.querySelector("[data-completed-work-divider]");
    const answer = container.querySelector("[data-rendered-transcript-item='answer']");
    expect(workContainer?.nextElementSibling).toBe(answer);
    expect(prelude?.compareDocumentPosition(divider!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(prelude?.querySelector("[data-late-diff-panel]")).not.toBeNull();
    expect(resolveTurnItemFrontierBlockKey(presentation)).toBe("item-answer");
  });

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
