import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IngestBatchV1 } from "@proliferate/product-client/internal/domain/diagnostics/contract";
import { RendererDiagnosticsBatcher } from "./renderer-diagnostics-batcher";
import {
  rendererDiagnosticTestRecord as record,
} from "./renderer-diagnostics-batcher-test-support";

const NATIVE_RESULTS = [
  "renderer_ingest_wrong_window",
  "renderer_ingest_invalid_batch",
  "renderer_ingest_collector_starting",
  "renderer_ingest_collector_unsupported",
  "renderer_ingest_collector_degraded",
  "renderer_ingest_collector_stopped",
  "renderer_ingest_collector_replaced",
  "renderer_ingest_broker_shutting_down",
  "renderer_ingest_collector_rejected",
  "renderer_ingest_deadline_exceeded",
  "renderer_ingest_protocol_error",
] as const;

describe("renderer diagnostics native result handling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(NATIVE_RESULTS)("handles %s once without retry", async (nativeResult) => {
    const invoke = vi.fn(async (_batch: IngestBatchV1) => {
      throw nativeResult;
    });
    const snapshots: Array<{
      byReason: Readonly<Record<string, number>>;
    }> = [];
    const queue = new RendererDiagnosticsBatcher({
      invoke,
      createLossRecord: (snapshot) => {
        snapshots.push(snapshot);
        return null;
      },
      now: () => Date.now(),
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });

    queue.emit(record(1, "warn"), 100);
    await vi.runAllTimersAsync();
    queue.emit(record(2, "warn"), 100);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(snapshots).toHaveLength(1);
    const expectedReason = nativeResult === "renderer_ingest_protocol_error"
      ? "invalid_receipt"
      : "invoke_failure";
    expect(snapshots[0].byReason[expectedReason]).toBe(1);
    expect(queue.getPendingStateForTest().lossTotal).toBe(1);
    vi.clearAllTimers();
  });
});
