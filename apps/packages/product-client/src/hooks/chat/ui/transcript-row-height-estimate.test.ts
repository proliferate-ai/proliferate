import { describe, expect, it } from "vitest";
import {
  estimateRenderableRowHeight,
  getRowCompositionToken,
  getRowEstimateBucketKey,
} from "#product/hooks/chat/ui/transcript-row-height-estimate";
import type { TurnPresentation } from "#product/domain/chats/transcript/transcript-presentation";
import type { TranscriptRenderableRow } from "#product/hooks/chat/ui/transcript-row-list-model";
import { HISTORY_LOADING_ROW_KEY } from "#product/hooks/chat/ui/transcript-row-list-model";

type TurnRow = Extract<TranscriptRenderableRow, { kind: "transcript" }>;

function presentation(overrides: Partial<TurnPresentation>): TurnPresentation {
  return {
    rootIds: [],
    childrenByParentId: new Map(),
    displayBlocks: [],
    finalAssistantItemId: null,
    completedHistoryRootIds: [],
    completedHistorySummary: null,
    ...overrides,
  };
}

function turnRow(
  blockKey: string,
  displayBlocks: TurnPresentation["displayBlocks"],
  rowIndex = 0,
): TurnRow {
  const renderPresentation = presentation({ displayBlocks });
  return {
    kind: "transcript",
    key: `turn:t1:block:${blockKey}`,
    rowIndex,
    row: {
      kind: "turn",
      key: `turn:t1:block:${blockKey}` as `turn:${string}:block:${string}`,
      turnId: "t1",
      blockKey,
      presentation: renderPresentation,
      renderPresentation,
      isFirstTurnRow: true,
      isLastTurnRow: true,
    },
  };
}

describe("estimateRenderableRowHeight — composition buckets", () => {
  it("keeps the history-loader special case at 32px", () => {
    const row: TranscriptRenderableRow = { kind: "history_loader", key: HISTORY_LOADING_ROW_KEY };
    expect(estimateRenderableRowHeight(row)).toBe(32);
  });

  it("keeps the goal-event special case at 28px", () => {
    const row: TranscriptRenderableRow = {
      kind: "transcript",
      key: "goal-event:g1",
      rowIndex: 0,
      row: {
        kind: "goal_event",
        key: "goal-event:g1",
        event: { seq: 1 } as never,
      },
    };
    expect(estimateRenderableRowHeight(row)).toBe(28);
  });

  it("estimates a short text-only turn (single item block) below the old flat fallback", () => {
    const row = turnRow("content", [{ kind: "item", itemId: "i1" }]);
    const estimate = estimateRenderableRowHeight(row);
    expect(estimate).toBe(120);
    expect(estimate).toBeLessThan(360);
  });

  it("estimates a long text-only turn (4+ item blocks) at the old flat fallback", () => {
    const row = turnRow("content", [
      { kind: "item", itemId: "i1" },
      { kind: "item", itemId: "i2" },
      { kind: "item", itemId: "i3" },
      { kind: "item", itemId: "i4" },
    ]);
    expect(estimateRenderableRowHeight(row)).toBe(360);
  });

  it("estimates a collapsed tool-group turn from its grouped item count, not the flat fallback", () => {
    const small = turnRow("group-small", [
      { kind: "collapsed_actions", blockId: "b1", itemIds: ["a", "b"] },
    ]);
    const large = turnRow("group-large", [
      { kind: "collapsed_actions", blockId: "b2", itemIds: Array.from({ length: 12 }, (_, i) => `t${i}`) },
    ]);
    expect(estimateRenderableRowHeight(small)).toBe(56);
    expect(estimateRenderableRowHeight(large)).toBe(120);
    expect(estimateRenderableRowHeight(large)).toBeGreaterThan(estimateRenderableRowHeight(small));
  });

  it("estimates a subagent-group turn distinctly from a tool-group turn", () => {
    const row = turnRow("subagents", [
      { kind: "subagent_creations", blockId: "s1", itemIds: ["sub-a", "sub-b", "sub-c"] },
    ]);
    expect(estimateRenderableRowHeight(row)).toBe(96);
  });

  it("estimates a completed-history summary chunk as a small compact row regardless of folded block count", () => {
    const row = turnRow("completed-history", [
      { kind: "item", itemId: "i1" },
      { kind: "item", itemId: "i2" },
      { kind: "collapsed_actions", blockId: "b1", itemIds: ["a", "b", "c", "d", "e"] },
    ]);
    expect(estimateRenderableRowHeight(row)).toBe(44);
  });

  it("mixed-composition turn (diff-card-like: item + inline tool) sums per-block estimates, not the flat fallback", () => {
    const row = turnRow("mixed", [
      { kind: "item", itemId: "i1" },
      { kind: "inline_tool", itemId: "tool-1" },
    ]);
    // item (120) + inline_tool (56)
    expect(estimateRenderableRowHeight(row)).toBe(176);
  });
});

describe("getRowCompositionToken — invalidation identity", () => {
  it("returns the SAME token across two rows sharing the same renderPresentation reference", () => {
    const shared = presentation({ displayBlocks: [{ kind: "item", itemId: "i1" }] });
    const rowA: TurnRow = {
      kind: "transcript",
      key: "turn:t1:block:content",
      rowIndex: 0,
      row: {
        kind: "turn",
        key: "turn:t1:block:content",
        turnId: "t1",
        blockKey: "content",
        presentation: shared,
        renderPresentation: shared,
        isFirstTurnRow: true,
        isLastTurnRow: true,
      },
    };
    const rowB: TurnRow = { ...rowA };

    expect(getRowCompositionToken(rowA)).toBe(getRowCompositionToken(rowB));
  });

  it("returns a DIFFERENT token when the renderPresentation object changes (content changed shape)", () => {
    const before = turnRow("content", [{ kind: "item", itemId: "i1" }]);
    const after = turnRow("content", [
      { kind: "item", itemId: "i1" },
      { kind: "inline_tool", itemId: "tool-1" },
    ]);

    expect(getRowCompositionToken(before)).not.toBe(getRowCompositionToken(after));
  });

  it("gives the history-loader row a stable constant token", () => {
    const row: TranscriptRenderableRow = { kind: "history_loader", key: HISTORY_LOADING_ROW_KEY };
    expect(getRowCompositionToken(row)).toBe(getRowCompositionToken({ ...row }));
  });
});

describe("getRowEstimateBucketKey — calibration pooling", () => {
  it("does NOT calibrate the fixed-height quiet background rows (they must not pool into the prompt bucket)", () => {
    const completionReceipt: TranscriptRenderableRow = {
      kind: "transcript",
      key: "completion-receipt:r1",
      rowIndex: 0,
      row: {
        kind: "completion_receipt",
        key: "completion-receipt:r1",
        receipt: { anchorTurnId: "t1" } as never,
      },
    };
    const backgroundWork: TranscriptRenderableRow = {
      kind: "transcript",
      key: "background-work",
      rowIndex: 0,
      row: { kind: "background_work", key: "background-work", runningCount: 2 },
    };

    // Aligned with the goal-event sibling: a small fixed constant, not worth
    // calibrating — so null, never the composer-shaped "prompt" bucket.
    expect(getRowEstimateBucketKey(completionReceipt)).toBeNull();
    expect(getRowEstimateBucketKey(backgroundWork)).toBeNull();
  });

  it("still buckets a real composer-shaped prompt row under \"prompt\" (positive control)", () => {
    const pendingPrompt: TranscriptRenderableRow = {
      kind: "transcript",
      key: "pending-prompt:p1",
      rowIndex: 0,
      row: { kind: "pending_prompt", key: "pending-prompt:p1" },
    };
    expect(getRowEstimateBucketKey(pendingPrompt)).toBe("prompt");
  });
});
