/* @vitest-environment jsdom */

// Deterministic negative control for the r5 pinned-follow regression (PRO-187).
// The composition-derived estimate model must NOT rotate the virtualizer's
// getItemKey / estimateSize identity when only a row's estimate VALUE changes
// (a streaming turn changing its display-block shape every chunk while its key
// stays fixed). TanStack rebuilds every item position when either accessor is a
// new reference; if that rebuild lands the frame after the single per-frame
// snap while pinned to a growing stream, the viewport trails the bottom — the
// r3 follow lag rung 4 fixed and r5 re-broke. The accessors may only rotate on
// a change to the ordered set of row KEYS. The estimate value itself must still
// update (read fresh from the live row) so unmeasured rows get the better guess.

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTranscriptVirtualMeasurementModel } from "#product/hooks/chat/ui/use-transcript-virtual-measurement-model";
import type { TranscriptRenderableRow } from "#product/hooks/chat/ui/transcript-row-list-model";
import type { TurnPresentation } from "#product/domain/chats/transcript/transcript-presentation";
import {
  clearMeasuredRowHeightsForTests,
  recordMeasuredRowHeight,
} from "#product/hooks/chat/ui/transcript-row-height-cache";
import { getRowCompositionToken } from "#product/hooks/chat/ui/transcript-row-height-estimate";

type TurnRow = Extract<TranscriptRenderableRow, { kind: "transcript" }>;

function turnRow(key: string, displayBlocks: TurnPresentation["displayBlocks"]): TurnRow {
  const renderPresentation: TurnPresentation = {
    rootIds: [],
    childrenByParentId: new Map(),
    displayBlocks,
    finalAssistantItemId: null,
    completedHistoryRootIds: [],
    completedHistorySummary: null,
  };
  return {
    kind: "transcript",
    key: key as `turn:${string}:block:${string}`,
    rowIndex: 0,
    row: {
      kind: "turn",
      key: key as `turn:${string}:block:${string}`,
      turnId: "t1",
      blockKey: "content",
      presentation: renderPresentation,
      renderPresentation,
      isFirstTurnRow: true,
      isLastTurnRow: true,
    },
  };
}

const KEY = "turn:t1:block:content";

describe("useTranscriptVirtualMeasurementModel accessor stability (PRO-187, r5)", () => {
  it("keeps getItemKey/estimateSize identity stable across an estimate-only change, with a fresh value", () => {
    const props = {
      activeSessionId: "s1",
      selectedWorkspaceId: "w1",
      // A short single-block turn: composition estimate 120.
      renderableRows: [turnRow(KEY, [{ kind: "item", itemId: "i1" }])] as TranscriptRenderableRow[],
    };
    const { result, rerender } = renderHook(
      (p: typeof props) => useTranscriptVirtualMeasurementModel(p),
      { initialProps: props },
    );

    const firstGetItemKey = result.current.getItemKey;
    const firstEstimateSize = result.current.estimateSize;
    expect(firstEstimateSize(0)).toBe(120);

    // The same-keyed turn streams into a long 4-block shape: composition
    // estimate jumps to 360. A NEW row array/object, same key.
    rerender({
      ...props,
      renderableRows: [
        turnRow(KEY, [
          { kind: "item", itemId: "i1" },
          { kind: "item", itemId: "i2" },
          { kind: "item", itemId: "i3" },
          { kind: "item", itemId: "i4" },
        ]),
      ] as TranscriptRenderableRow[],
    });

    // NEGATIVE CONTROL: with the accessors keyed on the composition signature
    // (the pre-fix model), both identities rotate here and TanStack rebuilds
    // every position — the extra layout pass that stranded the snap.
    expect(result.current.getItemKey).toBe(firstGetItemKey);
    expect(result.current.estimateSize).toBe(firstEstimateSize);
    // The estimate value still updates (read fresh from the live row).
    expect(result.current.estimateSize(0)).toBe(360);
  });

  it("rotates the accessors when the ordered set of row keys changes", () => {
    const props = {
      activeSessionId: "s1",
      selectedWorkspaceId: "w1",
      renderableRows: [turnRow(KEY, [{ kind: "item", itemId: "i1" }])] as TranscriptRenderableRow[],
    };
    const { result, rerender } = renderHook(
      (p: typeof props) => useTranscriptVirtualMeasurementModel(p),
      { initialProps: props },
    );
    const firstGetItemKey = result.current.getItemKey;

    // A new row appended: the ordered key set changed, so TanStack must re-key.
    rerender({
      ...props,
      renderableRows: [
        turnRow(KEY, [{ kind: "item", itemId: "i1" }]),
        turnRow("turn:t2:block:content", [{ kind: "item", itemId: "j1" }]),
      ] as TranscriptRenderableRow[],
    });

    expect(result.current.getItemKey).not.toBe(firstGetItemKey);
    expect(result.current.getItemKey(1)).toBe("turn:t2:block:content");
  });
});

describe("useTranscriptVirtualMeasurementModel measured-height supersedes estimate (PRO-187, r5)", () => {
  beforeEach(() => {
    clearMeasuredRowHeightsForTests();
  });
  afterEach(() => {
    clearMeasuredRowHeightsForTests();
  });

  it("sizes a row by its persisted measured height, and keeps it across an off-screen recycle", () => {
    // A single short block: composition estimate 120. The row object (and thus
    // its renderPresentation composition token) stays stable across the recycle,
    // exactly as the turn-row cache guarantees for an unchanged turn.
    const row = turnRow(KEY, [{ kind: "item", itemId: "i1" }]) as TranscriptRenderableRow;
    // The row measured taller for real (252): the persisted cache is written on
    // measurement (transcript-row-height-cache.ts), keyed by session + row key +
    // composition token.
    recordMeasuredRowHeight("w1:s1", KEY, 252, getRowCompositionToken(row));

    const props = {
      activeSessionId: "s1",
      selectedWorkspaceId: "w1",
      renderableRows: [row],
    };
    const { result, rerender } = renderHook(
      (p: typeof props) => useTranscriptVirtualMeasurementModel(p),
      { initialProps: props },
    );

    // Resolution order: a persisted real measurement supersedes the composition
    // estimate. NEGATIVE CONTROL: flip the order in estimateSize (composition
    // estimate first, persisted as fallback) and this reads 120, not 252.
    expect(result.current.estimateSize(0)).toBe(252);

    // Recycle: the row scrolls off-screen and back, arriving in a NEW array with
    // the SAME row identity/token. Mere recycling must NOT drop back to the
    // estimate — the persisted measurement still wins.
    rerender({ ...props, renderableRows: [row] });
    expect(result.current.estimateSize(0)).toBe(252);
  });

  it("totals a fully measured conversation from measured heights, not estimates", () => {
    const rowA = turnRow("turn:a:block:content", [
      { kind: "item", itemId: "a1" },
    ]) as TranscriptRenderableRow;
    const rowB = turnRow("turn:b:block:content", [
      { kind: "item", itemId: "b1" },
    ]) as TranscriptRenderableRow;
    // Each single-block turn's composition estimate is 120 (sum 240), but their
    // real measured heights are 252 and 300 (sum 552).
    recordMeasuredRowHeight("w1:s1", "turn:a:block:content", 252, getRowCompositionToken(rowA));
    recordMeasuredRowHeight("w1:s1", "turn:b:block:content", 300, getRowCompositionToken(rowB));

    const { result } = renderHook(
      (p) => useTranscriptVirtualMeasurementModel(p),
      {
        initialProps: {
          activeSessionId: "s1",
          selectedWorkspaceId: "w1",
          renderableRows: [rowA, rowB],
        },
      },
    );

    const total = result.current.estimateSize(0) + result.current.estimateSize(1);
    // Once measured, the total is the sum of MEASURED heights (552), not the sum
    // of composition estimates (240).
    expect(total).toBe(552);
  });
});
