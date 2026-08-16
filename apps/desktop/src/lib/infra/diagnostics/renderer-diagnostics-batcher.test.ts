import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  IngestBatchV1,
  IngestReceiptV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";
import {
  RENDERER_BATCH_RECORD_LIMIT,
  RENDERER_BATCH_BYTE_LIMIT,
  RENDERER_FLUSH_INTERVAL_MS,
  RENDERER_ORDINARY_BYTE_LIMIT,
  RENDERER_ORDINARY_RECORD_LIMIT,
  RENDERER_QUEUE_BYTE_LIMIT,
  RENDERER_QUEUE_RECORD_LIMIT,
  RendererDiagnosticsBatcher,
  type RendererLossSnapshot,
} from "./renderer-diagnostics-batcher";
import {
  deferredRendererDiagnosticTestValue as deferred,
  rendererDiagnosticTestReceipt as receipt,
  rendererDiagnosticTestRecord as record,
} from "./renderer-diagnostics-batcher-test-support";

describe("renderer diagnostics batcher", () => {
  let invoke: ReturnType<typeof vi.fn<(batch: IngestBatchV1) => Promise<IngestReceiptV1>>>;
  let nextLossSequence: number;
  let snapshots: RendererLossSnapshot[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:00.000Z"));
    invoke = vi.fn(async (batch) => receipt(batch.records.length));
    nextLossSequence = 10_000;
    snapshots = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function batcher() {
    return new RendererDiagnosticsBatcher({
      invoke,
      createLossRecord: (snapshot) => {
        snapshots.push(snapshot);
        return { record: {
          ...record(nextLossSequence++, "warn"),
          name: "renderer.diagnostics.loss",
          detailed: { kind: "loss_summary", dropped_count: snapshot.total },
        }, serializedBytes: 100 };
      },
      now: () => Date.now(),
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });
  }

  it("waits 50 ms for ordinary traffic and drains warn traffic immediately", async () => {
    const queue = batcher();
    queue.emit(record(1), 100);
    await vi.advanceTimersByTimeAsync(RENDERER_FLUSH_INTERVAL_MS - 1);
    expect(invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledTimes(1);

    queue.emit(record(2, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("detaches at 64 records and permits only one native invocation in flight", async () => {
    const first = deferred<IngestReceiptV1>();
    invoke.mockImplementationOnce(() => first.promise);
    const queue = batcher();
    for (let sequence = 1; sequence <= RENDERER_BATCH_RECORD_LIMIT * 2; sequence += 1) {
      queue.emit(record(sequence), 100);
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0].records).toHaveLength(RENDERER_BATCH_RECORD_LIMIT);
    expect(queue.getPendingStateForTest()).toMatchObject({
      records: RENDERER_BATCH_RECORD_LIMIT,
      invokeInFlight: true,
    });

    first.resolve(receipt(RENDERER_BATCH_RECORD_LIMIT));
    await vi.runAllTimersAsync();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("accounts for the compact batch envelope in the 256 KiB byte cap", async () => {
    const queue = batcher();
    for (let sequence = 1; sequence <= 4; sequence += 1) {
      queue.emit(record(sequence), 65_523);
    }

    await vi.advanceTimersByTimeAsync(RENDERER_FLUSH_INTERVAL_MS);
    expect(invoke.mock.calls[0][0].records.map((entry) => entry.producer_sequence))
      .toEqual([1, 2, 3]);
    expect(queue.getPendingStateForTest().sequences).toEqual([4]);
  });

  it("pins ordinary reserve, total byte admission, and byte-threshold flushing", async () => {
    const reserved = batcher();
    reserved.emit(record(1), RENDERER_ORDINARY_BYTE_LIMIT);
    expect(reserved.getPendingStateForTest()).toMatchObject({
      records: 1,
      bytes: RENDERER_ORDINARY_BYTE_LIMIT,
    });
    expect(() => reserved.emit(record(2), 1)).not.toThrow();
    expect(reserved.getPendingStateForTest()).toMatchObject({
      records: 1,
      lossTotal: 1,
    });

    const total = batcher();
    total.emit(record(10, "error"), RENDERER_QUEUE_BYTE_LIMIT);
    total.emit(record(11, "error"), 1);
    expect(total.getPendingStateForTest()).toMatchObject({ records: 2 });
    expect(total.getPendingStateForTest().sequences).toContain(11);
    expect(total.getPendingStateForTest().sequences).not.toContain(10);

    const threshold = batcher();
    for (let sequence = 20; sequence < 24; sequence += 1) {
      threshold.emit(record(sequence), RENDERER_BATCH_BYTE_LIMIT / 4);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalled();
    const lastCall = invoke.mock.calls[invoke.mock.calls.length - 1];
    expect(lastCall?.[0].records.map((entry) => entry.producer_sequence))
      .toEqual([20, 21, 22]);
  });

  it("preserves the ordinary reserve and evicts oldest ordinary evidence for priority", () => {
    const queue = batcher();
    for (let sequence = 1; sequence <= RENDERER_ORDINARY_RECORD_LIMIT + 1; sequence += 1) {
      queue.emit(record(sequence), 1);
    }
    expect(queue.getPendingStateForTest().records).toBe(RENDERER_ORDINARY_RECORD_LIMIT);
    expect(queue.getPendingStateForTest().lossTotal).toBe(1);

    for (
      let sequence = RENDERER_ORDINARY_RECORD_LIMIT + 2;
      sequence <= RENDERER_QUEUE_RECORD_LIMIT + 1;
      sequence += 1
    ) {
      queue.emit(record(sequence, "error"), 1);
    }
    expect(queue.getPendingStateForTest().records).toBe(RENDERER_QUEUE_RECORD_LIMIT);

    queue.emit(record(1_000, "warn"), 1);
    const state = queue.getPendingStateForTest();
    expect(state.records).toBe(RENDERER_QUEUE_RECORD_LIMIT);
    expect(state.sequences).not.toContain(1);
    expect(state.sequences).toContain(1_000);
    expect(state.lossTotal).toBeGreaterThan(1);
  });

  it("evicts the oldest priority record when the queue has only priority evidence", () => {
    const queue = batcher();
    for (let sequence = 1; sequence <= RENDERER_QUEUE_RECORD_LIMIT + 1; sequence += 1) {
      queue.emit(record(sequence, "error"), 1);
    }

    const state = queue.getPendingStateForTest();
    expect(state.records).toBe(RENDERER_QUEUE_RECORD_LIMIT);
    expect(state.sequences).not.toContain(1);
    expect(state.sequences).toContain(RENDERER_QUEUE_RECORD_LIMIT + 1);
    expect(state.lossTotal).toBeGreaterThanOrEqual(1);
  });

  it("appends one closed loss snapshot after lower sequences and clears only on proof", async () => {
    const queue = batcher();
    queue.noteLoss("invalid_input", "info");
    queue.emit(record(1, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);

    const sent = invoke.mock.calls[0][0].records;
    expect(sent.map((entry) => entry.name)).toEqual([
      "renderer.test.batch",
      "renderer.diagnostics.loss",
    ]);
    expect(sent[0].producer_sequence).toBeLessThan(sent[1].producer_sequence);
    expect(sent[1].detailed?.dropped_count).toBe(1);
    expect(snapshots).toHaveLength(1);
    expect(queue.getPendingStateForTest().lossTotal).toBe(0);
  });

  it("contains a throwing loss-record builder during admission and retries after receipt", async () => {
    let attempts = 0;
    const queue = new RendererDiagnosticsBatcher({
      invoke,
      createLossRecord: (snapshot) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("loss builder failed");
        }
        return {
          record: {
            ...record(10_000, "warn"),
            name: "renderer.diagnostics.loss",
            detailed: { kind: "loss_summary", dropped_count: snapshot.total },
          },
          serializedBytes: 100,
        };
      },
      now: () => Date.now(),
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });
    queue.noteLoss("invalid_input", "info");

    expect(() => queue.emit(record(1, "warn"), 100)).not.toThrow();
    await vi.runAllTimersAsync();
    expect(invoke.mock.calls[0][0].records.map((entry) => entry.name))
      .toEqual(["renderer.test.batch"]);
    expect(invoke.mock.calls[1][0].records.map((entry) => entry.name))
      .toEqual(["renderer.diagnostics.loss"]);
    expect(queue.getPendingStateForTest().lossTotal).toBe(0);
  });

  it("does not rewrite a coherent acknowledgement when later loss construction throws", async () => {
    const native = deferred<IngestReceiptV1>();
    invoke.mockImplementationOnce(() => native.promise);
    let attempts = 0;
    const queue = new RendererDiagnosticsBatcher({
      invoke,
      createLossRecord: (snapshot) => {
        attempts += 1;
        if (attempts === 2) {
          throw new Error("later loss builder failed");
        }
        return {
          record: {
            ...record(10_000 + attempts, "warn"),
            name: "renderer.diagnostics.loss",
            detailed: { kind: "loss_summary", dropped_count: snapshot.total },
          },
          serializedBytes: 100,
        };
      },
      now: () => Date.now(),
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });
    queue.noteLoss("invalid_input", "info");
    const acknowledged = queue.emitAcknowledged(record(1, "error"), 100);
    await vi.advanceTimersByTimeAsync(0);
    queue.noteLoss("pressure_drop", "debug");

    native.resolve(receipt(2));
    await Promise.resolve();
    await Promise.resolve();
    await expect(acknowledged).resolves.toBe(true);
    expect(queue.getPendingStateForTest().lossTotal).toBe(2);

    queue.emit(record(2, "warn"), 100);
    await vi.runAllTimersAsync();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][0].records.map((entry) => entry.name))
      .toEqual(["renderer.test.batch", "renderer.diagnostics.loss"]);
  });

  it("keeps one loss snapshot outstanding across queue and detached in-flight state", async () => {
    const first = deferred<IngestReceiptV1>();
    invoke.mockImplementationOnce(() => first.promise);
    const queue = batcher();
    queue.noteLoss("invalid_input", "info");
    queue.emit(record(1, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);

    queue.noteLoss("pressure_drop", "debug");
    queue.emit(record(2), 100);
    expect(snapshots).toHaveLength(1);
    expect(queue.getPendingStateForTest().sequences).toEqual([2]);

    first.resolve(receipt(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toMatchObject({
      total: 1,
      byReason: { pressure_drop: 1 },
    });
  });

  it("preserves failed loss snapshots across indexed rejection and invoke failure", async () => {
    invoke.mockResolvedValueOnce({
      ...receipt(1),
      accepted_count: 1,
      rejections: [{ index: 1, reason: "invalid_shape" }],
    });
    const rejected = batcher();
    rejected.noteLoss("invalid_input", "info");
    rejected.emit(record(1, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].total).toBe(1);
    expect(snapshots[1]).toMatchObject({
      total: 2,
      byReason: { invalid_input: 1, collector_rejection: 1 },
    });

    snapshots = [];
    invoke.mockReset();
    invoke.mockRejectedValueOnce(new Error("renderer_ingest_collector_stopped"));
    invoke.mockImplementation(async (batch) => receipt(batch.records.length));
    const failed = batcher();
    failed.noteLoss("invalid_input", "info");
    failed.emit(record(2, "warn"), 100);
    await vi.runAllTimersAsync();
    failed.emit(record(3, "warn"), 100);
    await vi.runAllTimersAsync();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toMatchObject({
      total: 3,
      byReason: { invalid_input: 1, collector_stopped: 2 },
    });
  });

  it("subtracts only a successful closed snapshot after concurrent acknowledgement loss", async () => {
    const native = deferred<IngestReceiptV1>();
    invoke.mockImplementationOnce(() => native.promise);
    const queue = batcher();
    queue.noteLoss("invalid_input", "info");
    const acknowledged = queue.emitAcknowledged(record(1, "error"), 100);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await expect(acknowledged).resolves.toBe(false);

    native.resolve(receipt(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      total: 1,
      byReason: { invalid_input: 1 },
    });
    expect(snapshots[1]).toMatchObject({
      total: 1,
      byReason: { acknowledgement_timeout: 1 },
    });
  });

  it("never retries a failed detached batch and reports it in a later summary", async () => {
    invoke.mockRejectedValueOnce(new Error("renderer_ingest_collector_degraded"));
    const queue = batcher();
    queue.emit(record(1, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(queue.getPendingStateForTest()).toMatchObject({ records: 0, lossTotal: 1 });

    queue.emit(record(2, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][0].records.map((entry) => entry.name)).toEqual([
      "renderer.test.batch",
      "renderer.diagnostics.loss",
    ]);
  });

  it("appends detached invoke loss to the already-queued next batch without retry", async () => {
    const first = deferred<IngestReceiptV1>();
    invoke.mockImplementationOnce(() => first.promise);
    const queue = batcher();
    queue.emit(record(1, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);
    queue.emit(record(2), 100);

    first.reject(new Error("renderer_ingest_collector_stopped"));
    await vi.runAllTimersAsync();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][0].records.map((entry) => [
      entry.producer_sequence,
      entry.name,
    ])).toEqual([
      [2, "renderer.test.batch"],
      [10_000, "renderer.diagnostics.loss"],
    ]);
    expect(invoke.mock.calls.flatMap(([batch]) => batch.records)
      .filter((entry) => entry.producer_sequence === 1)).toHaveLength(1);
  });

  it("contains a throwing development warning after invoke failure and keeps draining", async () => {
    invoke.mockRejectedValueOnce(new Error("renderer_ingest_collector_stopped"));
    const queue = new RendererDiagnosticsBatcher({
      invoke,
      createLossRecord: () => null,
      now: () => Date.now(),
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
      warn: () => {
        throw new Error("console warning failed");
      },
    });
    queue.emit(record(1, "warn"), 100);
    await vi.runAllTimersAsync();
    expect(queue.getPendingStateForTest().lossTotal).toBe(1);

    queue.emit(record(2, "warn"), 100);
    await vi.runAllTimersAsync();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("classifies parser and coherence failures as invalid receipts", async () => {
    invoke.mockRejectedValueOnce("renderer_ingest_protocol_error");
    const queue = batcher();
    queue.emit(record(1, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);

    queue.emit(record(2, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshots[0].byReason.invalid_receipt).toBe(1);
    expect(snapshots[0].byReason.invoke_failure).toBe(0);
  });

  it("applies elevated and critical admission with one probe after one second", async () => {
    invoke.mockResolvedValueOnce(receipt(1, "elevated"));
    const pressureProbe = deferred<IngestReceiptV1>();
    invoke.mockImplementationOnce(() => pressureProbe.promise);
    const queue = batcher();
    queue.emit(record(1, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);

    queue.emit(record(2, "debug"), 100);
    queue.emit(record(3, "info"), 100);
    expect(queue.getPendingStateForTest().sequences).toContain(3);
    expect(queue.getPendingStateForTest().sequences).not.toContain(2);

    await vi.advanceTimersByTimeAsync(1_000);
    queue.emit(record(4, "debug"), 100);
    queue.emit(record(5, "info"), 100);
    expect(queue.getPendingStateForTest().sequences).toContain(4);
    expect(queue.getPendingStateForTest().sequences).not.toContain(5);

    pressureProbe.resolve(receipt(1, "critical"));
    await Promise.resolve();
    await Promise.resolve();
    queue.emit(record(6, "info"), 100);
    queue.emit(record(7, "error"), 100);
    expect(queue.getPendingStateForTest().sequences).not.toContain(6);
    expect(queue.getPendingStateForTest().sequences).toContain(7);
  });

  it("does not consume the pressure probe when queue admission fails", async () => {
    const queue = batcher();
    invoke.mockResolvedValueOnce(receipt(1, "elevated"));
    queue.emit(record(1, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    queue.emit(record(2, "debug"), RENDERER_QUEUE_BYTE_LIMIT + 1);
    queue.emit(record(3, "debug"), 100);

    expect(queue.getPendingStateForTest().sequences).not.toContain(2);
    expect(queue.getPendingStateForTest().sequences).toContain(3);
  });

  it("reopens the pressure probe after a definite invoke failure", async () => {
    const queue = batcher();
    invoke.mockResolvedValueOnce(receipt(1, "elevated"));
    queue.emit(record(1, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    invoke.mockRejectedValueOnce(new Error("renderer_ingest_collector_stopped"));
    queue.emit(record(2, "debug"), 100);
    await vi.advanceTimersByTimeAsync(RENDERER_FLUSH_INTERVAL_MS);

    queue.emit(record(3, "debug"), 100);
    expect(queue.getPendingStateForTest().sequences).toContain(3);
  });

  it("reopens the pressure probe when priority admission evicts the queued probe", async () => {
    const held = deferred<IngestReceiptV1>();
    invoke.mockResolvedValueOnce(receipt(1, "elevated"));
    invoke.mockImplementationOnce(() => held.promise);
    invoke.mockImplementation(async (batch) => receipt(batch.records.length, "elevated"));
    const queue = batcher();
    queue.emit(record(1, "warn"), 1);
    await vi.advanceTimersByTimeAsync(0);

    for (let sequence = 2; sequence <= 255; sequence += 1) {
      queue.emit(record(sequence, "error"), 1);
    }
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    queue.emit(record(300, "debug"), 1);
    expect(queue.getPendingStateForTest().sequences).toContain(300);

    for (let sequence = 301; sequence <= 365; sequence += 1) {
      queue.emit(record(sequence, "error"), 1);
    }
    expect(queue.getPendingStateForTest().sequences).not.toContain(300);

    held.resolve(receipt(RENDERER_BATCH_RECORD_LIMIT, "elevated"));
    await vi.runAllTimersAsync();
    await vi.advanceTimersByTimeAsync(1_000);
    queue.emit(record(400, "debug"), 1);
    expect(queue.getPendingStateForTest().sequences).toContain(400);
  });

  it("retains one queued pressure probe across an unrelated non-normal receipt", async () => {
    const unrelated = deferred<IngestReceiptV1>();
    const probe = deferred<IngestReceiptV1>();
    invoke.mockResolvedValueOnce(receipt(1, "elevated"));
    invoke.mockImplementationOnce(() => unrelated.promise);
    invoke.mockImplementationOnce(() => probe.promise);
    const queue = batcher();
    queue.emit(record(1, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);

    queue.emit(record(2, "error"), 100);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    queue.emit(record(3, "debug"), 100);
    expect(queue.getPendingStateForTest().sequences).toContain(3);

    unrelated.resolve(receipt(1, "elevated"));
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_000);
    queue.emit(record(4, "debug"), 100);
    expect(queue.getPendingStateForTest().sequences).not.toContain(4);

    probe.resolve(receipt(1, "normal"));
    await Promise.resolve();
  });

  it("bounds acknowledged delivery at 500 ms and ignores a late success", async () => {
    const native = deferred<IngestReceiptV1>();
    invoke.mockImplementationOnce(() => native.promise);
    const queue = batcher();
    const acknowledged = queue.emitAcknowledged(record(1, "error"), 100, 5_000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await expect(acknowledged).resolves.toBe(false);
    expect(queue.getPendingStateForTest().lossTotal).toBe(1);

    native.resolve(receipt(1));
    await Promise.resolve();
    await expect(acknowledged).resolves.toBe(false);
  });

  it("coalesces repeated flush callers onto one bounded idle waiter", async () => {
    const native = deferred<IngestReceiptV1>();
    invoke.mockImplementationOnce(() => native.promise);
    const queue = batcher();
    queue.emit(record(1, "warn"), 100);
    await vi.advanceTimersByTimeAsync(0);

    const flushes = Array.from({ length: 100 }, (_, index) =>
      queue.flush(index === 99 ? 100 : 500));
    expect(queue.getPendingStateForTest().idleWaiters).toBe(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(queue.getPendingStateForTest().idleWaiters).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(Promise.all(flushes)).resolves.toEqual(
      Array.from({ length: 100 }, () => undefined),
    );
    expect(queue.getPendingStateForTest().idleWaiters).toBe(0);

    native.resolve(receipt(1));
    await Promise.resolve();
  });

  it("treats duplicate admission as acknowledged and indexed rejection as failure", async () => {
    invoke.mockResolvedValueOnce({
      ...receipt(0),
      accepted_count: 0,
      duplicate_count: 1,
      accepted_range: undefined,
    });
    const queue = batcher();
    const duplicate = queue.emitAcknowledged(record(1, "error"), 100);
    await vi.advanceTimersByTimeAsync(0);
    await expect(duplicate).resolves.toBe(true);

    invoke.mockResolvedValueOnce({
      ...receipt(0),
      accepted_count: 0,
      duplicate_count: 0,
      accepted_range: undefined,
      rejections: [{ index: 0, reason: "invalid_shape" }],
    });
    const rejected = queue.emitAcknowledged(record(2, "error"), 100);
    await vi.advanceTimersByTimeAsync(0);
    await expect(rejected).resolves.toBe(false);
    expect(queue.getPendingStateForTest().lossTotal).toBe(1);
  });
});
