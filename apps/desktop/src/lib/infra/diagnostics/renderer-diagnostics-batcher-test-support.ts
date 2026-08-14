import type {
  IngestReceiptV1,
  PressureV1,
  ProducerRecordV1,
  SeverityV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";

export function rendererDiagnosticTestRecord(
  sequence: number,
  severity: SeverityV1 = "info",
): ProducerRecordV1 {
  return {
    schema_version: { major: 1, minor: 1 },
    source_timestamp: "2026-08-11T12:00:00.000Z",
    producer_sequence: sequence,
    producer_boot_id: "boot",
    component: "desktop_renderer",
    source: "renderer",
    release: "test",
    environment: "test",
    operation_id: `operation-${sequence}`,
    name: "renderer.test.batch",
    severity,
    arguments: [],
    record_class: "detailed",
    privacy: "operational",
    redaction: "none",
    detailed: { kind: "log" },
  };
}

export function rendererDiagnosticTestReceipt(
  count: number,
  pressure: PressureV1 = "normal",
): IngestReceiptV1 {
  return {
    schema_version: { major: 1, minor: 1 },
    collector_boot_id: "collector-boot",
    accepted_range: count === 0 ? undefined : { first: 1, last: count },
    accepted_count: count,
    duplicate_count: 0,
    rejections: [],
    pressure,
  };
}

export function deferredRendererDiagnosticTestValue<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
