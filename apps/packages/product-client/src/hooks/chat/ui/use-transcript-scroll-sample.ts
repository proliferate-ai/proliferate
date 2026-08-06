import { useCallback, useEffect, useRef } from "react";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementMetric,
  startMeasurementOperation,
} from "#product/lib/infra/measurement/measurement-port";
import type { TranscriptScrollSample } from "#product/hooks/chat/ui/transcript-row-list-model";

const TRANSCRIPT_SCROLL_SURFACES = [
  "transcript-list",
  "transcript-context-providers",
  "transcript-row-list-router",
  "transcript-virtualized-viewport",
  "transcript-full-list",
  "session-transcript-pane",
  "chat-surface",
] as const;

/**
 * Couples scroll-priority sampling to the transcript's diagnostic measurement
 * operation without making the transcript container own telemetry lifecycle.
 */
export function useTranscriptScrollSample(
  prioritizeScrollSample: (sample?: TranscriptScrollSample) => void,
): (sample?: TranscriptScrollSample) => void {
  const scrollSampleOperationRef = useRef<MeasurementOperationId | null>(null);

  const handleTranscriptScroll = useCallback((sample?: TranscriptScrollSample) => {
    prioritizeScrollSample(sample);
    // Tag the scroll source: a persistent stream of `source.programmatic`
    // samples (with no user input) means a stick-to-bottom snap / virtualizer
    // measurement feedback loop — the difference between "user scrolled" and
    // "we are scrolling ourselves in circles".
    recordMeasurementMetric({
      type: "diagnostic",
      category: "transcript_scroll",
      label: sample === undefined
        ? "source.unknown"
        : sample.programmatic
          ? "source.programmatic"
          : sample.userInitiated
            ? "source.user"
            : "source.unclassified",
      count: 1,
    });
    const operationId = startMeasurementOperation({
      kind: "transcript_scroll",
      sampleKey: "transcript",
      surfaces: [...TRANSCRIPT_SCROLL_SURFACES],
      idleTimeoutMs: 750,
      maxDurationMs: 8000,
      cooldownMs: 1500,
    });
    if (operationId) {
      scrollSampleOperationRef.current = operationId;
      markOperationForNextCommit(operationId, [...TRANSCRIPT_SCROLL_SURFACES]);
    }
  }, [prioritizeScrollSample]);

  useEffect(() => () => {
    finishOrCancelMeasurementOperation(scrollSampleOperationRef.current, "unmount");
    scrollSampleOperationRef.current = null;
  }, []);

  return handleTranscriptScroll;
}
