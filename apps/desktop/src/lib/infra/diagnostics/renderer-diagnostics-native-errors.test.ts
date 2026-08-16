import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IngestBatchV1 } from "@proliferate/product-client/internal/domain/diagnostics/contract";
import { RendererDiagnosticsBatcher } from "./renderer-diagnostics-batcher";
import { LOSS_REASONS } from "./renderer-diagnostics-batcher-limits";
import {
  rendererDiagnosticTestRecord as record,
} from "./renderer-diagnostics-batcher-test-support";

const NATIVE_RESULTS = [
  ["renderer_ingest_wrong_window", "wrong_window"],
  ["renderer_ingest_invalid_batch", "invalid_batch"],
  ["renderer_ingest_collector_starting", "collector_starting"],
  ["renderer_ingest_collector_unsupported", "collector_unsupported"],
  ["renderer_ingest_collector_degraded", "collector_degraded"],
  ["renderer_ingest_collector_stopped", "collector_stopped"],
  ["renderer_ingest_collector_replaced", "collector_replaced"],
  ["renderer_ingest_broker_shutting_down", "broker_shutting_down"],
  ["renderer_ingest_collector_rejected", "collector_rejected"],
  ["renderer_ingest_deadline_exceeded", "deadline_exceeded"],
  ["renderer_ingest_protocol_error", "invalid_receipt"],
] as const;

const UNKNOWN_RESULTS = [
  "renderer_ingest_from_the_future",
  "connection reset",
  "",
] as const;

describe("renderer diagnostics native result handling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness(rejection: unknown) {
    const invoke = vi.fn(async (_batch: IngestBatchV1) => {
      throw rejection;
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
    return { invoke, snapshots, queue };
  }

  it.each(NATIVE_RESULTS)("counts %s as %s once without retry", async (nativeResult, reason) => {
    const { invoke, snapshots, queue } = harness(nativeResult);

    queue.emit(record(1, "warn"), 100);
    await vi.runAllTimersAsync();
    queue.emit(record(2, "warn"), 100);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].byReason[reason]).toBe(1);
    expect(snapshots[0].byReason.invoke_failure).toBe(0);
    expect(queue.getPendingStateForTest().lossTotal).toBe(1);
    vi.clearAllTimers();
  });

  it.each(NATIVE_RESULTS)("classifies %s carried on an Error message", async (nativeResult, reason) => {
    const { snapshots, queue } = harness(new Error(nativeResult));

    queue.emit(record(1, "warn"), 100);
    await vi.runAllTimersAsync();
    queue.emit(record(2, "warn"), 100);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].byReason[reason]).toBe(1);
    vi.clearAllTimers();
  });

  it.each(UNKNOWN_RESULTS)("counts unknown rejection %j as invoke_failure", async (nativeResult) => {
    const { snapshots, queue } = harness(nativeResult);

    queue.emit(record(1, "warn"), 100);
    await vi.runAllTimersAsync();
    queue.emit(record(2, "warn"), 100);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].byReason.invoke_failure).toBe(1);
    vi.clearAllTimers();
  });

  it("reports the full loss vocabulary, including ingest reasons, in every snapshot", async () => {
    const { snapshots, queue } = harness("renderer_ingest_collector_stopped");

    queue.emit(record(1, "warn"), 100);
    await vi.runAllTimersAsync();
    queue.emit(record(2, "warn"), 100);

    expect(snapshots).toHaveLength(1);
    expect(Object.keys(snapshots[0].byReason).sort()).toEqual([...LOSS_REASONS].sort());
    vi.clearAllTimers();
  });
});
