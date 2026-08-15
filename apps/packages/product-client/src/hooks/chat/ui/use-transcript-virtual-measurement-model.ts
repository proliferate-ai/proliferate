import { useCallback, useMemo } from "react";
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
  // TanStack keys its measurement memo on getItemKey identity. Serialize only
  // the ordered key/estimate inputs, then retain the parsed model and accessors
  // across content-only row snapshots. They rotate only when row composition
  // or session scope changes, which is exactly when measurements must rebuild.
  //
  // The estimate embedded here is the COMPOSITION estimate only. A persisted
  // real measurement (when one exists for this row key + session) is
  // consulted on top of it in `estimateSize` below, not baked into this
  // signature — the persisted cache is intentionally allowed to change
  // independent of row composition (a real measurement lands whenever
  // TanStack observes it, not on the cadence that rebuilds this signature).
  const measurementSignature = useMemo(
    () => JSON.stringify(renderableRows.map((row) => [
      row.key,
      estimateRenderableRowHeight(row),
    ] satisfies VirtualMeasurementEntry)),
    [renderableRows],
  );
  const measurementEntries = useMemo(
    () => JSON.parse(measurementSignature) as VirtualMeasurementEntry[],
    [measurementSignature],
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
    (index: number) => measurementEntries[index]?.[0] ?? index,
    [measurementEntries, rowCompositionKey],
  );
  // estimateSize consults, in order: (a) a persisted real measurement for
  // this row key in this session (rung 5 remount-scoped cache), (b) the
  // composition estimate. Never a bare flat fallback except for an
  // out-of-range index (the composition estimator's own `undefined` case).
  const estimateSize = useCallback(
    (index: number) => {
      const entry = measurementEntries[index];
      if (!entry) {
        return estimateRenderableRowHeight(undefined);
      }
      const [key, compositionEstimate] = entry;
      const row = renderableRows[index];
      const persisted = getMeasuredRowHeight(
        sessionKey,
        key,
        getRowCompositionToken(row),
      );
      return persisted ?? compositionEstimate;
    },
    [measurementEntries, renderableRows, rowCompositionKey, sessionKey],
  );
  const estimatedRowsHeight = useMemo(
    () => measurementEntries.reduce((sum, entry) => sum + entry[1], 0),
    [measurementEntries],
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
