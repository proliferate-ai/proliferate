import { describe, expect, it } from "vitest";
import { createLargeInterruptedCompletedTurnFixture } from "./transcript-presentation-test-fixtures";
import {
  buildTranscriptRowModel,
  type TranscriptRow,
} from "./transcript-row-model";

describe("buildTranscriptRowModel completed history", () => {
  it("projects one canonical completed-history row for a large interrupted turn", () => {
    const fixture = createLargeInterruptedCompletedTurnFixture();
    const beforeProjection = JSON.stringify({
      turn: fixture.turn,
      items: fixture.itemIds.map((itemId) => fixture.transcript.itemsById[itemId]),
    });
    const buildRows = () => buildTranscriptRowModel({
      activeSessionId: fixture.transcript.sessionMeta.sessionId,
      transcript: fixture.transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: fixture.turn.turnId,
      latestTurnHasAssistantRenderableContent: true,
    });

    const rows = buildRows();
    const turnRows = rows.filter(
      (row): row is Extract<TranscriptRow, { kind: "turn" }> => row.kind === "turn",
    );
    const completedHistoryRows = turnRows.filter(
      (row) => row.blockKey === "completed-history",
    );
    const rowKeys = turnRows.map((row) => row.key);
    const finalAssistantItemId = fixture.assistantItemIds.at(-1);

    expect([
      fixture.itemIds.length,
      new Set(fixture.itemIds).size,
      fixture.toolItemIds.length,
      fixture.assistantItemIds.length,
    ]).toEqual([152, 152, 146, 5]);
    expect(JSON.stringify({
      turn: fixture.turn,
      items: fixture.itemIds.map((itemId) => fixture.transcript.itemsById[itemId]),
    })).toBe(beforeProjection);
    expect(turnRows.map((row) => row.blockKey)).toEqual([
      fixture.userItemId,
      "completed-history",
      ...fixture.mutationReceiptItemIds,
      finalAssistantItemId,
    ]);
    expect(completedHistoryRows).toHaveLength(1);
    expect(completedHistoryRows[0]?.presentation.completedHistoryRootIds)
      .toEqual(fixture.completedHistoryItemIds);
    expect(completedHistoryRows[0]?.presentation.completedHistorySummary).toEqual({
      messages: 4,
      toolCalls: 143,
      subagents: 0,
    });
    expect(completedHistoryRows[0]?.renderPresentation.displayBlocks).toHaveLength(8);
    expect(completedHistoryRows[0]?.renderPresentation.displayBlocks.flatMap((block) =>
      "itemIds" in block ? block.itemIds : [block.itemId]
    )).toEqual(fixture.completedHistoryItemIds);
    expect(new Set(rowKeys).size).toBe(rowKeys.length);
    expect(buildRows().map((row) => row.key)).toEqual(rows.map((row) => row.key));
  });
});
