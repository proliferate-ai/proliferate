import type {
  ComponentV1,
  DetailedKindV1,
  MetadataPhaseV1,
  PrivacyClassificationV1,
  RecordClassV1,
  RedactionClassificationV1,
  RejectionReasonV1,
  SeverityV1,
  SourceV1,
  TerminalOutcomeV1,
} from "./contract";

export const COMPONENTS = new Set<ComponentV1>([
  "desktop_renderer",
  "desktop_tauri",
  "diagnostics_collector",
  "anyharness",
  "desktop_worker",
  "server",
]);
export const SOURCES = new Set<SourceV1>([
  "renderer",
  "tauri",
  "collector",
  "anyharness",
  "worker",
  "server",
]);
export const SEVERITIES = new Set<SeverityV1>(["trace", "debug", "info", "warn", "error"]);
export const RECORD_CLASSES = new Set<RecordClassV1>(["detailed", "lifecycle"]);
export const PRIVACY = new Set<PrivacyClassificationV1>([
  "operational",
  "customer_content",
  "sensitive",
  "secret",
]);
export const REDACTION = new Set<RedactionClassificationV1>([
  "none",
  "structural",
  "support_export",
]);
export const DETAILED_KINDS = new Set<DetailedKindV1>([
  "log",
  "span_event",
  "message",
  "stdio",
  "token_delta",
  "item_delta",
  "heartbeat",
  "progress",
  "transport",
  "milestone",
  "loss_summary",
]);
export const TERMINAL_OUTCOMES = new Set<TerminalOutcomeV1>([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "abandoned",
  "rejected",
  "skipped",
]);
export const METADATA_PHASES = new Set<MetadataPhaseV1>([
  "prepare",
  "invoke",
  "stream",
  "complete",
]);
export const REJECTION_REASONS = new Set<RejectionReasonV1>([
  "invalid_shape",
  "record_too_large",
  "batch_too_large",
  "unsupported_major",
  "unsupported_minor",
  "prohibited_secret",
  "prohibited_metadata",
  "limit_exceeded",
  "conflicting_terminal",
]);
export const SECRET_FIELD_NAMES = new Set([
  "authorization",
  "authorization_header",
  "cookie",
  "cookies",
  "access_token",
  "refresh_token",
  "raw_token",
  "private_key",
  "secret",
  "environment_values",
  "keychain",
]);
export const PROHIBITED_MODEL_PLUGIN_FIELDS = new Set([
  "prompt",
  "response",
  "content",
  "tool_arguments",
  "tool_results",
  "arguments",
  "results",
  "raw_payload",
  "provider_response",
  "command",
  "path",
]);
