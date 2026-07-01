import type {
  MeasurementOperationId,
  MeasurementSurface,
} from "@/lib/domain/telemetry/debug-measurement-catalog";
import {
  onMeasurementOperationFinish,
  recordMeasurementMetric,
} from "./debug-measurement";
import { isMainThreadMeasurementEnabled } from "./debug-measurement-env";
import { round } from "./debug-measurement-utils";

// Keystroke → paint latency probe.
//
// React's Profiler only sees render+commit time. What the user FEELS when
// typing is the full pipeline: input event queued → handler runs → React
// renders/commits → layout → paint. This probe measures that end to end and
// splits it into the two halves that matter for diagnosis:
//
//   input_delay        = handler start − event.timeStamp
//                        (event sat in the queue: main thread was busy —
//                        long tasks, GC, other work, machine thrash)
//   keystroke_to_paint = after-next-paint − event.timeStamp
//                        (total user-felt latency for the keystroke)
//
// High input_delay with modest commit times ⇒ the main thread is saturated by
// something other than this component's render (look at long tasks / other
// surfaces / the machine). Low input_delay with high keystroke_to_paint ⇒ the
// render/layout/paint work for this keystroke is itself too slow.
//
// Samples are recorded as `diagnostic` metrics (category "input_latency") so
// they appear in the per-operation measurement_summary console.table and the
// __PROLIFERATE_DEBUG_MEASUREMENT__ dump, and a compact percentile line is
// printed when each typing operation finishes. No-op unless
// VITE_PROLIFERATE_DEBUG_MAIN_THREAD is enabled.

interface TypingLatencyBucket {
  surface: MeasurementSurface;
  toPaintMs: number[];
  inputDelayMs: number[];
}

const MAX_SAMPLES_PER_OPERATION = 1_000;
const bucketsByOperation = new Map<MeasurementOperationId, TypingLatencyBucket>();

export function recordTypingKeystrokeLatency(input: {
  operationId: MeasurementOperationId | null;
  surface: MeasurementSurface;
  /** `event.timeStamp` from the input/change event (performance.now() clock). */
  eventTimeStampMs: number | null | undefined;
}): void {
  if (!isMainThreadMeasurementEnabled()) {
    return;
  }
  const handlerStartMs = performance.now();
  // event.timeStamp is a DOMHighResTimeStamp on the performance.now() clock in
  // modern engines; guard against epoch-based, missing, or future values.
  const eventMs =
    typeof input.eventTimeStampMs === "number"
    && input.eventTimeStampMs > 0
    && input.eventTimeStampMs <= handlerStartMs
      ? input.eventTimeStampMs
      : handlerStartMs;
  const inputDelayMs = handlerStartMs - eventMs;
  const { operationId, surface } = input;

  afterPaint(() => {
    const toPaintMs = performance.now() - eventMs;
    recordMeasurementMetric({
      type: "diagnostic",
      category: "input_latency",
      label: `${surface}.keystroke_to_paint`,
      operationId: operationId ?? undefined,
      durationMs: toPaintMs,
    });
    recordMeasurementMetric({
      type: "diagnostic",
      category: "input_latency",
      label: `${surface}.input_delay`,
      operationId: operationId ?? undefined,
      durationMs: inputDelayMs,
    });
    if (operationId) {
      trackSample(operationId, surface, toPaintMs, inputDelayMs);
    }
  });
}

/**
 * Runs right after the next frame paints. rAF fires before paint; a
 * MessageChannel message posted during the rAF callback is delivered as a
 * macrotask after the frame's rendering steps complete. (A double-rAF would
 * overreport by a full extra frame — it fires at the START of the frame after
 * next.)
 */
function afterPaint(callback: () => void): void {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    setTimeout(callback, 0);
    return;
  }
  window.requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => callback();
    channel.port2.postMessage(null);
  });
}

function trackSample(
  operationId: MeasurementOperationId,
  surface: MeasurementSurface,
  toPaintMs: number,
  inputDelayMs: number,
): void {
  let bucket = bucketsByOperation.get(operationId);
  if (!bucket) {
    bucket = { surface, toPaintMs: [], inputDelayMs: [] };
    bucketsByOperation.set(operationId, bucket);
    onMeasurementOperationFinish(operationId, ({ reason }) => {
      const finished = bucketsByOperation.get(operationId);
      bucketsByOperation.delete(operationId);
      if (finished && finished.toPaintMs.length > 0) {
        printTypingLatencySummary(operationId, finished, reason);
      }
    });
  }
  if (bucket.toPaintMs.length >= MAX_SAMPLES_PER_OPERATION) {
    return;
  }
  bucket.toPaintMs.push(toPaintMs);
  bucket.inputDelayMs.push(inputDelayMs);
}

function printTypingLatencySummary(
  operationId: MeasurementOperationId,
  bucket: TypingLatencyBucket,
  reason: string,
): void {
  const toPaint = percentiles(bucket.toPaintMs);
  const inputDelay = percentiles(bucket.inputDelayMs);
  console.info(
    `[typing-latency] ${bucket.surface} n=${bucket.toPaintMs.length}`
    + ` | keystroke→paint p50=${toPaint.p50}ms p95=${toPaint.p95}ms max=${toPaint.max}ms`
    + ` | inputDelay p50=${inputDelay.p50}ms p95=${inputDelay.p95}ms max=${inputDelay.max}ms`
    + ` (${operationId}, ${reason})`,
  );
}

function percentiles(values: readonly number[]): { p50: number; p95: number; max: number } {
  if (values.length === 0) {
    return { p50: 0, p95: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? 0;
  return {
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1] ?? 0),
  };
}
