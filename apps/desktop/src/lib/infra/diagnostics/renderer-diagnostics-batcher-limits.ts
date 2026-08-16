// Queue, batch, and lane budgets for the renderer diagnostics batcher, plus the
// closed loss vocabulary the ledger counts against.

import type {
  ProducerRecordV1,
  SeverityV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";

export const RENDERER_QUEUE_RECORD_LIMIT = 256;
export const RENDERER_QUEUE_BYTE_LIMIT = 524_288;
export const RENDERER_ORDINARY_RECORD_LIMIT = 224;
export const RENDERER_ORDINARY_BYTE_LIMIT = 458_752;
export const RENDERER_BATCH_RECORD_LIMIT = 64;
export const RENDERER_BATCH_BYTE_LIMIT = 262_144;
export const RENDERER_FLUSH_INTERVAL_MS = 50;
export const RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS = 500;

export const LOSS_REASONS = [
  "invalid_input",
  "filter_failure",
  "queue_overflow",
  "queue_eviction",
  "pressure_drop",
  "invoke_failure",
  "invalid_receipt",
  "collector_rejection",
  "acknowledgement_timeout",
  // Whole-batch invoke rejections, named after the native
  // `renderer_ingest_*` classification suffixes so bursts can be attributed
  // to a supervisor state instead of collapsing into `invoke_failure`.
  // `collector_rejected` is the batch-level twin of the per-record
  // `collector_rejection` above.
  "wrong_window",
  "invalid_batch",
  "collector_starting",
  "collector_unsupported",
  "collector_degraded",
  "collector_stopped",
  "collector_replaced",
  "broker_shutting_down",
  "collector_rejected",
  "deadline_exceeded",
] as const;

export const SEVERITIES = ["trace", "debug", "info", "warn", "error"] as const;

// A batch always ships this envelope, so the byte budget has to account for it
// before the first record is admitted.
export const RENDERER_BATCH_ENVELOPE_BYTES = new TextEncoder().encode(JSON.stringify({
  schema_version: { major: 1, minor: 1 },
  records: [],
})).byteLength;

export type RendererLossReason = (typeof LOSS_REASONS)[number];

export interface RendererLossSnapshot {
  total: number;
  byReason: Readonly<Record<RendererLossReason, number>>;
  bySeverity: Readonly<Record<SeverityV1, number>>;
}

export interface RendererLossRecord {
  record: ProducerRecordV1;
  serializedBytes: number;
}
