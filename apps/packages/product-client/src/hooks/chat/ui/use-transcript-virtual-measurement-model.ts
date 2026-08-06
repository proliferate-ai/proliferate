import { useCallback, useMemo } from "react";
import {
  estimateRenderableRowHeight,
  type TranscriptRenderableRow,
} from "#product/hooks/chat/ui/transcript-row-list-model";

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
  // TanStack keys its measurement memo on getItemKey identity. Serialize only
  // the ordered key/estimate inputs, then retain the parsed model and accessors
  // across content-only row snapshots. They rotate only when row composition
  // or session scope changes, which is exactly when measurements must rebuild.
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
  const estimateSize = useCallback(
    (index: number) => measurementEntries[index]?.[1]
      ?? estimateRenderableRowHeight(undefined),
    [measurementEntries, rowCompositionKey],
  );
  const estimatedRowsHeight = useMemo(
    () => measurementEntries.reduce((sum, entry) => sum + entry[1], 0),
    [measurementEntries],
  );

  return {
    estimateSize,
    estimatedRowsHeight,
    getItemKey,
    rowCompositionKey,
  };
}
