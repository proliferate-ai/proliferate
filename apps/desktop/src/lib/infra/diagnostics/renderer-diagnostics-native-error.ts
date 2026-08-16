// Maps the stable `renderer_ingest_*` rejection strings produced by the
// native `ingest_renderer_diagnostics` command onto the renderer loss
// vocabulary. Unknown rejections stay `invoke_failure` so an older or newer
// native side never breaks loss accounting.

import type { RendererLossReason } from "./renderer-diagnostics-batcher-limits";

const INGEST_ERROR_REASONS = new Map<string, RendererLossReason>([
  ["renderer_ingest_protocol_error", "invalid_receipt"],
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
]);

export function classifyRendererIngestError(error: unknown): RendererLossReason {
  const message = rendererIngestErrorMessage(error);
  if (message === null) {
    return "invoke_failure";
  }
  return INGEST_ERROR_REASONS.get(message) ?? "invoke_failure";
}

function rendererIngestErrorMessage(error: unknown): string | null {
  if (typeof error === "string") {
    return error;
  }
  if (typeof error !== "object" || error === null) {
    return null;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    return descriptor !== undefined
      && "value" in descriptor
      && typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}
