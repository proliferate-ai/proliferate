import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  IngestBatchV1,
  IngestReceiptV1,
  ProducerRecordV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { ingestRendererDiagnosticsBatch } from "./diagnostics";

function record(sequence: number): ProducerRecordV1 {
  return {
    schema_version: { major: 1, minor: 1 },
    source_timestamp: "2026-08-11T12:00:00.000Z",
    producer_sequence: sequence,
    producer_boot_id: "boot-id",
    component: "desktop_renderer",
    source: "renderer",
    release: "desktop@0.4.8+000000000000",
    environment: "test",
    operation_id: `operation-${sequence}`,
    name: "renderer.test.record",
    severity: "info",
    arguments: [],
    record_class: "detailed",
    privacy: "operational",
    redaction: "none",
    detailed: { kind: "log" },
  };
}

function batch(): IngestBatchV1 {
  return {
    schema_version: { major: 1, minor: 1 },
    records: [record(1), record(2)],
  };
}

function receipt(overrides: Partial<IngestReceiptV1> = {}): IngestReceiptV1 {
  return {
    schema_version: { major: 1, minor: 1 },
    collector_boot_id: "collector-boot",
    accepted_range: { first: 41, last: 42 },
    accepted_count: 2,
    duplicate_count: 0,
    rejections: [],
    pressure: "normal",
    ...overrides,
  };
}

describe("renderer diagnostics ingest wrapper", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  });

  it("passes only the accepted batch to the final native command", async () => {
    invoke.mockResolvedValue(receipt());

    await expect(ingestRendererDiagnosticsBatch(batch())).resolves.toEqual(receipt());
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "ingest_renderer_diagnostics",
      { batch: batch() },
    );
  });

  it.each([
    receipt({ schema_version: { major: 1, minor: 0 } }),
    receipt({ accepted_count: 1 }),
    receipt({ accepted_count: 0 }),
    receipt({ accepted_count: 1, accepted_range: undefined }),
    receipt({ accepted_count: 2, accepted_range: { first: 42, last: 41 } }),
    receipt({ accepted_count: 2, accepted_range: { first: 41, last: 43 } }),
    receipt({ accepted_count: 0, duplicate_count: 0, rejections: [
      { index: 0, reason: "invalid_shape" },
      { index: 0, reason: "invalid_shape" },
    ], accepted_range: undefined }),
    receipt({ accepted_count: 1, duplicate_count: 0, rejections: [
      { index: 2, reason: "invalid_shape" },
    ] }),
  ])("rejects an incoherent receipt", async (invalidReceipt) => {
    invoke.mockResolvedValue(invalidReceipt);

    await expect(ingestRendererDiagnosticsBatch(batch())).rejects.toThrow(
      "renderer_ingest_protocol_error",
    );
  });

  it("normalizes parser-invalid receipts without rewriting native invoke errors", async () => {
    invoke.mockResolvedValueOnce({
      schema_version: { major: 1, minor: 9 },
      collector_boot_id: "collector-boot",
    });
    await expect(ingestRendererDiagnosticsBatch(batch())).rejects.toThrow(
      "renderer_ingest_protocol_error",
    );

    invoke.mockRejectedValueOnce(new Error("renderer_ingest_collector_stopped"));
    await expect(ingestRendererDiagnosticsBatch(batch())).rejects.toThrow(
      "renderer_ingest_collector_stopped",
    );

    invoke.mockRejectedValueOnce("renderer_ingest_protocol_error");
    await expect(ingestRendererDiagnosticsBatch(batch())).rejects.toBe(
      "renderer_ingest_protocol_error",
    );
  });

  it("rejects non-v1.1 or foreign-owner batches before invoke", async () => {
    const invalidBatch = batch();
    invalidBatch.records[0] = { ...invalidBatch.records[0], component: "desktop_tauri" };

    await expect(ingestRendererDiagnosticsBatch(invalidBatch)).rejects.toThrow(
      "renderer_ingest_invalid_batch",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a schema-v1.0 request before invoke even though the shared parser accepts it", async () => {
    const invalidBatch = batch();
    invalidBatch.schema_version = { major: 1, minor: 0 };

    await expect(ingestRendererDiagnosticsBatch(invalidBatch)).rejects.toThrow(
      "renderer_ingest_invalid_batch",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
