import { useCallback, useMemo, useRef } from "react";
import { measureElement as defaultMeasureElement } from "@tanstack/react-virtual";
import type { Virtualizer } from "@tanstack/react-virtual";
import {
  estimateRenderableRowHeight,
  getRowCompositionToken,
  type TranscriptRenderableRow,
} from "#product/hooks/chat/ui/transcript-row-list-model";
import {
  getMeasuredRowHeight,
  recordMeasuredRowHeight,
} from "#product/hooks/chat/ui/transcript-row-height-cache";

type VirtualMeasurementEntry = readonly [key: string, estimatedSize: number];

export function useTranscriptVirtualMeasurementModel({
  activeSessionId,
  renderableRows,
  selectedWorkspaceId,
}: {
  activeSessionId: string;
  renderableRows: readonly TranscriptRenderableRow[];
  selectedWorkspaceId: string | null;
}) {
  // Same identity used by useTranscriptStickToBottom's `sessionKey` — scopes
  // the rung 5 measured-height cache to remounts of the SAME session (see
  // transcript-row-height-cache.ts). Never persisted beyond this runtime.
  const sessionKey = `${selectedWorkspaceId ?? ""}:${activeSessionId}`;
  // Live row snapshot read at call time by the referentially-stable accessors
  // below. estimateSize/measureElement need the current row (for its
  // composition token) without themselves rotating on every content-only
  // snapshot — rotating them would violate the accessor-stability contract the
  // measurement memo relies on (see measurementSignature note below) and churn
  // TanStack's estimate pass each render. A ref keeps the read fresh; identity
  // stays pinned to composition/session scope.
  const renderableRowsRef = useRef(renderableRows);
  renderableRowsRef.current = renderableRows;
  // TanStack memoizes its measurement derivation on getItemKey / estimateSize
  // IDENTITY: whenever either accessor is a new function reference, it rebuilds
  // every item's position from scratch. That rebuild is an extra layout pass —
  // and if it lands the frame AFTER the single per-frame snap while pinned to a
  // growing stream, the snap is left one measurement-generation behind and the
  // viewport trails the bottom (the rung-3 follow lag rung 4 fixed).
  //
  // So the accessors must rotate ONLY when the ordered set of row KEYS changes
  // (a structural change TanStack genuinely must re-key on), never when a row's
  // composition ESTIMATE changes. A streaming turn changes its display-block
  // shape — and therefore its composition estimate — on every chunk while its
  // key stays fixed; rotating the accessors on that churn is what defeated the
  // snap. The estimate itself still updates (read fresh from the row ref at call
  // time below), and correctness never rests on the guess: the on-screen
  // streaming row is measured, and the persisted-measurement cache is
  // invalidated by getRowCompositionToken, not by accessor identity.
  const keySignature = useMemo(
    () => JSON.stringify(renderableRows.map((row) => row.key)),
    [renderableRows],
  );
  const orderedKeys = useMemo(
    () => JSON.parse(keySignature) as string[],
    [keySignature],
  );
  // rowCompositionKey still embeds the composition estimates: it is consumed by
  // the anchor-capture cleanup, which snapshots the reader's position before a
  // composition change shifts layout, so it must rotate on composition — not
  // only on the ordered keys.
  const measurementSignature = useMemo(
    () => JSON.stringify(renderableRows.map((row) => [
      row.key,
      estimateRenderableRowHeight(row),
    ] satisfies VirtualMeasurementEntry)),
    [renderableRows],
  );
  const rowCompositionKey = useMemo(
    () => JSON.stringify([
      selectedWorkspaceId,
      activeSessionId,
      measurementSignature,
    ]),
    [activeSessionId, measurementSignature, selectedWorkspaceId],
  );
  const getItemKey = useCallback(
    (index: number) => orderedKeys[index] ?? index,
    [orderedKeys],
  );
  // estimateSize consults, in order: (a) a persisted real measurement for
  // this row key in this session (rung 5 remount-scoped cache), (b) the
  // composition estimate, both read FRESH from the live row ref so a streaming
  // turn's shifting estimate applies without rotating this accessor's identity.
  // Never a bare flat fallback except for an out-of-range index (the
  // composition estimator's own `undefined` case).
  const estimateSize = useCallback(
    (index: number) => {
      const key = orderedKeys[index];
      if (key === undefined) {
        return estimateRenderableRowHeight(undefined);
      }
      const row = renderableRowsRef.current[index];
      const persisted = getMeasuredRowHeight(
        sessionKey,
        key,
        getRowCompositionToken(row),
      );
      return persisted ?? estimateRenderableRowHeight(row);
    },
    [orderedKeys, sessionKey],
  );
  const estimatedRowsHeight = useMemo(
    () => renderableRows.reduce((sum, row) => sum + estimateRenderableRowHeight(row), 0),
    [renderableRows],
  );
  // Wraps TanStack's own default measurer so every REAL measurement (initial
  // mount, or a later ResizeObserver-driven remeasure) writes through to the
  // rung 5 persistence cache before being returned. `data-index` is set by
  // every measured row (see VirtualTranscriptViewport.tsx); an element
  // missing it (shouldn't happen) just skips the write-through.
  const measureElement = useCallback(
    (
      element: Element,
      entry: ResizeObserverEntry | undefined,
      instance: Virtualizer<HTMLDivElement, Element>,
    ) => {
      const measured = defaultMeasureElement(element, entry, instance);
      const indexAttr = element.getAttribute("data-index");
      const index = indexAttr === null ? Number.NaN : Number(indexAttr);
      const row = renderableRows[index];
      if (row) {
        recordMeasuredRowHeight(sessionKey, row.key, measured, getRowCompositionToken(row));
      }
      return measured;
    },
    [renderableRows, sessionKey],
  );

  return {
    estimateSize,
    estimatedRowsHeight,
    getItemKey,
    measureElement,
    rowCompositionKey,
  };
}
