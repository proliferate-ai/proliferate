import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  IngestBatchV1,
  IngestReceiptV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";
import {
  RENDERER_QUEUE_BYTE_LIMIT,
  RENDERER_QUEUE_RECORD_LIMIT,
  RendererDiagnosticsBatcher,
} from "./renderer-diagnostics-batcher";
import {
  deferredRendererDiagnosticTestValue as deferred,
  rendererDiagnosticTestReceipt as receipt,
  rendererDiagnosticTestRecord as record,
} from "./renderer-diagnostics-batcher-test-support";

describe("renderer diagnostics total pending bounds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function batcher(
    invoke: (batch: IngestBatchV1) => Promise<IngestReceiptV1>,
  ): RendererDiagnosticsBatcher {
    return new RendererDiagnosticsBatcher({
      invoke,
      createLossRecord: () => null,
      now: () => Date.now(),
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });
  }

  it("counts a detached invocation inside the 256-record pending cap", async () => {
    const held = deferred<IngestReceiptV1>();
    const queue = batcher(vi.fn(() => held.promise));
    for (let sequence = 1; sequence <= 64; sequence += 1) {
      queue.emit(record(sequence, "warn"), 1);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getPendingStateForTest()).toMatchObject({
      inFlightRecords: 64,
      records: 0,
      totalRecords: 64,
    });

    for (let sequence = 65; sequence <= 320; sequence += 1) {
      queue.emit(record(sequence, "warn"), 1);
    }
    expect(queue.getPendingStateForTest()).toMatchObject({
      inFlightRecords: 64,
      records: 192,
      totalRecords: RENDERER_QUEUE_RECORD_LIMIT,
    });

    held.resolve(receipt(64));
    await vi.runAllTimersAsync();
  });

  it("counts detached bytes inside the 512 KiB pending cap", async () => {
    const held = deferred<IngestReceiptV1>();
    const queue = batcher(vi.fn(() => held.promise));
    for (let sequence = 1; sequence <= 64; sequence += 1) {
      queue.emit(record(sequence, "warn"), 4_000);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getPendingStateForTest().inFlightRecords).toBe(64);

    for (let sequence = 65; sequence <= 320; sequence += 1) {
      queue.emit(record(sequence, "warn"), 4_000);
    }
    const pending = queue.getPendingStateForTest();
    expect(pending.totalBytes).toBeLessThanOrEqual(RENDERER_QUEUE_BYTE_LIMIT);
    expect(pending.totalRecords).toBeLessThan(RENDERER_QUEUE_RECORD_LIMIT);
    expect(pending.inFlightBytes).toBe(256_000);

    held.resolve(receipt(64));
    await vi.runAllTimersAsync();
  });
});
