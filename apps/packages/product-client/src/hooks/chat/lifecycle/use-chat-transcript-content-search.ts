import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import type {
  PendingPromptEntry,
  TranscriptState,
} from "@anyharness/sdk";
import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import type { GoalTranscriptEvent } from "@proliferate/product-domain/activity/goal-transcript-events";
import {
  buildTranscriptRowModel,
  createTranscriptRowModelCache,
  type TranscriptRowModelCache,
} from "@proliferate/product-domain/chats/transcript/transcript-row-model";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import { turnHasAssistantRenderableTranscriptContent } from "@proliferate/product-domain/chats/pending-prompts/pending-prompts";
import {
  findContentSearchMatches,
  normalizeContentSearchQuery,
} from "#product/lib/domain/content-search/content-search";
import { extractTranscriptRowProseSegments } from "#product/lib/domain/content-search/transcript-search-text";
import { useContentSearchStore } from "#product/stores/search/content-search-store";

interface ChatTranscriptContentSearchInput {
  transcript: TranscriptState;
  activeSessionId: string;
  optimisticPrompt: PendingPromptEntry | null;
  outboxEntries: readonly PromptOutboxEntry[];
  goalEvents: readonly GoalTranscriptEvent[];
}

interface IndexedUnit {
  unitId: string;
  matchIds: string[];
  orderKey: number;
}

const EMPTY_ROWS: readonly TranscriptVirtualRow[] = [];
const EMPTY_UNITS: readonly IndexedUnit[] = [];

// Row object -> its extracted prose segments. Rows from the row-model cache are
// referentially stable while their content is unchanged, so a streaming update
// only recomputes the rows that actually changed.
const rowSegmentCache = new WeakMap<TranscriptVirtualRow, string[]>();

/**
 * Data-level content-search index for the chat surface: the authoritative
 * source of match counts and navigation order (the DOM paint layer is
 * best-effort). Registers one store unit per transcript row that contains
 * matches, keyed `chatrow:<rowKey>` so the jump-to-match layer can recover the
 * row from an active match id. Entirely inert unless chat search is open with a
 * non-empty query. See specs/codebase/features/content-search.md.
 */
export function useChatTranscriptContentSearch({
  transcript,
  activeSessionId,
  optimisticPrompt,
  outboxEntries,
  goalEvents,
}: ChatTranscriptContentSearchInput): void {
  const open = useContentSearchStore((state) => state.open);
  const surface = useContentSearchStore((state) => state.surface);
  const rawQuery = useContentSearchStore((state) => state.query);
  const registerUnit = useContentSearchStore((state) => state.registerUnit);
  const unregisterUnit = useContentSearchStore((state) => state.unregisterUnit);

  const deferredQuery = useDeferredValue(rawQuery);
  const query = normalizeContentSearchQuery(deferredQuery);
  const shouldIndex = open && surface === "chat" && query.length > 0;

  const rowCacheRef = useRef<TranscriptRowModelCache>(createTranscriptRowModelCache());

  const rows = useMemo<readonly TranscriptVirtualRow[]>(() => {
    if (!shouldIndex) {
      return EMPTY_ROWS;
    }
    const latestTurnId = transcript.turnOrder[transcript.turnOrder.length - 1] ?? null;
    const latestTurn = latestTurnId ? transcript.turnsById[latestTurnId] ?? null : null;
    return buildTranscriptRowModel(
      {
        activeSessionId,
        transcript,
        visibleOptimisticPrompt: optimisticPrompt,
        visibleOutboxEntries: outboxEntries,
        latestTurnId,
        latestTurnHasAssistantRenderableContent:
          turnHasAssistantRenderableTranscriptContent(latestTurn, transcript),
        goalEvents,
      },
      rowCacheRef.current,
    );
  }, [shouldIndex, transcript, activeSessionId, optimisticPrompt, outboxEntries, goalEvents]);

  const units = useMemo<readonly IndexedUnit[]>(() => {
    if (!shouldIndex) {
      return EMPTY_UNITS;
    }
    const result: IndexedUnit[] = [];
    rows.forEach((row, rowIndex) => {
      const segments = getRowSegments(row, transcript);
      let count = 0;
      for (const segment of segments) {
        count += findContentSearchMatches(segment, query).length;
      }
      if (count === 0) {
        return;
      }
      const unitId = `chatrow:${row.key}`;
      result.push({
        unitId,
        matchIds: Array.from({ length: count }, (_, index) => `${unitId}:${index}`),
        orderKey: rowIndex * 2,
      });
    });
    return result;
  }, [shouldIndex, rows, transcript, query]);

  const registeredRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const nextIds = new Set(units.map((unit) => unit.unitId));
    for (const unitId of registeredRef.current) {
      if (!nextIds.has(unitId)) {
        unregisterUnit(unitId);
      }
    }
    for (const unit of units) {
      registerUnit({
        unitId: unit.unitId,
        surface: "chat",
        query,
        matchIds: unit.matchIds,
        orderKey: unit.orderKey,
      });
    }
    registeredRef.current = nextIds;
  }, [units, query, registerUnit, unregisterUnit]);

  useEffect(
    () => () => {
      for (const unitId of registeredRef.current) {
        unregisterUnit(unitId);
      }
      registeredRef.current = new Set();
    },
    [unregisterUnit],
  );
}

function getRowSegments(row: TranscriptVirtualRow, transcript: TranscriptState): string[] {
  const cached = rowSegmentCache.get(row);
  if (cached) {
    return cached;
  }
  const segments = extractTranscriptRowProseSegments(row, transcript);
  rowSegmentCache.set(row, segments);
  return segments;
}
