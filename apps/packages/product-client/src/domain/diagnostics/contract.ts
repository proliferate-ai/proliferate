export interface SchemaVersionV1 {
  major: number;
  minor: number;
}

export type SeverityV1 = "trace" | "debug" | "info" | "warn" | "error";
export type RecordClassV1 = "detailed" | "lifecycle";
export type LifecyclePhaseV1 = "started" | "terminal";
export type TerminalOutcomeV1 =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "abandoned"
  | "rejected"
  | "skipped";
export type ComponentV1 =
  | "desktop_renderer"
  | "desktop_tauri"
  | "diagnostics_collector"
  | "anyharness"
  | "desktop_worker"
  | "server";
export type SourceV1 =
  | "renderer"
  | "tauri"
  | "collector"
  | "anyharness"
  | "worker"
  | "server";
export type PrivacyClassificationV1 =
  | "operational"
  | "customer_content"
  | "sensitive"
  | "secret";
export type RedactionClassificationV1 =
  | "none"
  | "structural"
  | "support_export";
export type RejectionReasonV1 =
  | "invalid_shape"
  | "record_too_large"
  | "batch_too_large"
  | "unsupported_major"
  | "unsupported_minor"
  | "prohibited_secret"
  | "prohibited_metadata"
  | "limit_exceeded"
  | "conflicting_terminal";
export type PressureV1 = "normal" | "elevated" | "critical";
export type GapReasonV1 =
  | "evicted"
  | "producer_sequence"
  | "tail_lag"
  | "collector_restart";
export type HealthStatusV1 = "starting" | "ready" | "degraded" | "stopping";
export type ProducerLivenessV1 =
  | "attached"
  | "alive"
  | "dead"
  | "incompatible";
export type ExporterStateV1 = "disabled" | "ready" | "degraded";
export type FallbackStateV1 = "inactive" | "active" | "degraded";
export type DetailedKindV1 =
  | "log"
  | "span_event"
  | "message"
  | "stdio"
  | "token_delta"
  | "item_delta"
  | "heartbeat"
  | "progress"
  | "transport"
  | "milestone"
  | "loss_summary";
export type StandardStreamV1 = "stdout" | "stderr";
export type LifecycleFinalizerV1 = "producer" | "collector";
export type MetadataPhaseV1 = "prepare" | "invoke" | "stream" | "complete";

export type ArgumentValueV1 =
  | { type: "string"; value: string }
  | { type: "integer"; value: number }
  | { type: "float"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "enum"; value: string }
  | { type: "list"; value: ArgumentValueV1[] }
  | { type: "object"; value: Record<string, ArgumentValueV1> };

export interface TypedArgumentV1 {
  name: string;
  privacy: PrivacyClassificationV1;
  value: ArgumentValueV1;
}

export interface ModelMetadataV1 {
  model_id: string;
  provider_kind?: string;
  phase?: MetadataPhaseV1;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
}

export interface PluginMetadataV1 {
  plugin_id: string;
  kind?: string;
  phase?: MetadataPhaseV1;
  duration_ms?: number;
}

export interface DetailedDiagnosticV1 {
  kind: DetailedKindV1;
  message?: string;
  stream?: StandardStreamV1;
  dropped_count?: number;
  milestone?: string;
}

export interface CanonicalLifecycleV1 {
  phase: LifecyclePhaseV1;
  outcome?: TerminalOutcomeV1;
  finalizer: LifecycleFinalizerV1;
  model?: ModelMetadataV1;
  plugin?: PluginMetadataV1;
}

export interface ProducerRecordV1 {
  schema_version: SchemaVersionV1;
  source_timestamp: string;
  producer_sequence: number;
  producer_boot_id: string;
  component: ComponentV1;
  source: SourceV1;
  release: string;
  environment: string;
  operation_id: string;
  parent_operation_id?: string;
  trace_id?: string;
  workspace_id?: string;
  session_id?: string;
  turn_id?: string;
  item_id?: string;
  request_id?: string;
  target_id?: string;
  prompt_id?: string;
  workflow_id?: string;
  name: string;
  severity: SeverityV1;
  arguments: TypedArgumentV1[];
  error_classification?: string;
  record_class: RecordClassV1;
  privacy: PrivacyClassificationV1;
  redaction: RedactionClassificationV1;
  detailed?: DetailedDiagnosticV1;
  lifecycle?: CanonicalLifecycleV1;
}

export interface CollectorAcceptedRecordV1 {
  record: ProducerRecordV1;
  accepted_timestamp: string;
  accepted_order: number;
  retention_cursor: number;
}

export type TokenReferenceKindV1 =
  | "inherited_file_descriptor"
  | "process_memory";

export interface ProtectedTokenReferenceV1 {
  kind: TokenReferenceKindV1;
  reference: string;
}

export interface ConnectionDescriptorV1 {
  endpoint: string;
  token_reference: ProtectedTokenReferenceV1;
  schema_major: number;
  collector_boot_id: string;
}

export interface IngestBatchV1 {
  schema_version: SchemaVersionV1;
  records: ProducerRecordV1[];
}

export interface AcceptedOrderRangeV1 {
  first: number;
  last: number;
}

export interface IngestRejectionV1 {
  index: number;
  reason: RejectionReasonV1;
}

export interface IngestReceiptV1 {
  schema_version: SchemaVersionV1;
  collector_boot_id: string;
  accepted_range?: AcceptedOrderRangeV1;
  accepted_count: number;
  duplicate_count: number;
  rejections: IngestRejectionV1[];
  pressure: PressureV1;
}

export interface RecordsFilterV1 {
  source_time_from?: string;
  source_time_to?: string;
  components: ComponentV1[];
  record_classes: RecordClassV1[];
  severities: SeverityV1[];
  names: string[];
  outcomes: TerminalOutcomeV1[];
  operation_id?: string;
  parent_operation_id?: string;
  trace_id?: string;
  workspace_id?: string;
  session_id?: string;
  turn_id?: string;
  item_id?: string;
  request_id?: string;
  target_id?: string;
  prompt_id?: string;
  workflow_id?: string;
  error_classification?: string;
}

export interface RecordsQueryV1 {
  schema_version: SchemaVersionV1;
  after_cursor?: number;
  limit: number;
  filters: RecordsFilterV1;
}

export interface GapV1 {
  reason: GapReasonV1;
  from_cursor?: number;
  to_cursor?: number;
  component?: ComponentV1;
  producer_boot_id?: string;
  missing_sequence_from?: number;
  missing_sequence_to?: number;
  dropped_records: number;
}

export interface VersionCountV1 {
  version: SchemaVersionV1;
  records: number;
}

export interface RecordsPageV1 {
  schema_version: SchemaVersionV1;
  records: CollectorAcceptedRecordV1[];
  next_cursor?: number;
  gaps: GapV1[];
  versions_present: VersionCountV1[];
}

export type TailFrameV1 =
  | {
      frame: "records";
      records: CollectorAcceptedRecordV1[];
      cursor: number;
    }
  | { frame: "lag"; dropped_frames: number; resume_after_cursor: number }
  | { frame: "gap"; gap: GapV1 };

export type ExportPurposeV1 = "support" | "internal_dogfood";

export interface ExportRequestV1 {
  schema_version: SchemaVersionV1;
  purpose: ExportPurposeV1;
  support_authorization_id?: string;
  filters: RecordsFilterV1;
  record_limit: number;
  byte_limit: number;
  include_health: boolean;
}

export interface ExportManifestV1 {
  schema_version: SchemaVersionV1;
  snapshot_id: string;
  generated_at: string;
  record_count: number;
  byte_count: number;
  cursor_start?: number;
  cursor_end?: number;
  gaps: GapV1[];
  versions_present: VersionCountV1[];
  filters: RecordsFilterV1;
  redaction: RedactionClassificationV1;
  includes_health: boolean;
}

export type ExportStreamFrameV1 =
  | { frame: "manifest"; manifest: ExportManifestV1 }
  | { frame: "record"; record: CollectorAcceptedRecordV1 }
  | { frame: "gap"; gap: GapV1 }
  | { frame: "health"; health: HealthResponseV1 }
  | { frame: "end"; records: number; bytes: number };

export interface ProducerHealthV1 {
  component: ComponentV1;
  producer_boot_id: string;
  schema_version: SchemaVersionV1;
  last_sequence?: number;
  gap_count: number;
  liveness: ProducerLivenessV1;
}

export interface ExporterHealthV1 {
  state: ExporterStateV1;
  dropped_records: number;
  last_error_classification?: string;
}

export interface FallbackHealthV1 {
  state: FallbackStateV1;
  bytes: number;
  dropped_records: number;
}

export interface HealthResponseV1 {
  schema_version: SchemaVersionV1;
  status: HealthStatusV1;
  collector_boot_id: string;
  restart_count: number;
  pressure: PressureV1;
  oldest_cursor?: number;
  newest_cursor?: number;
  retained_bytes: number;
  evictions_by_class: Partial<Record<RecordClassV1, number>>;
  evictions_by_component: Partial<Record<ComponentV1, number>>;
  evictions_by_reason: Partial<Record<GapReasonV1, number>>;
  rejections_by_reason: Partial<Record<RejectionReasonV1, number>>;
  cardinality_counts: Record<string, number>;
  rejected_records: number;
  oversized_records: number;
  duplicate_terminals: number;
  conflicting_terminals: number;
  producers: ProducerHealthV1[];
  tail_reader_drops: number;
  exporter: ExporterHealthV1;
  fallback: FallbackHealthV1;
}

export interface RssWarmupV1 {
  duration_seconds: number;
  records: number;
}

export interface RssConcurrencyV1 {
  ingest_writers: number;
  query_readers: number;
  tail_readers: number;
  export_readers: number;
}

export interface RssStressV1 {
  duration_seconds: number;
  records_per_second: number;
  oversized_record_every: number;
  slow_tail_delay_ms: number;
  fail_exporter_after_records: number;
}

export interface RssSamplingV1 {
  interval_ms: number;
  command_template: string;
  samples_output: string;
}

export interface RssPassFailV1 {
  total_rss_limit_bytes: number;
  retained_arena_limit_bytes: number;
  required_conditions: string[];
}

export interface RssMeasurementProfileV1 {
  schema_version: SchemaVersionV1;
  targets: string[];
  build_profile: string;
  warmup: RssWarmupV1;
  concurrency: RssConcurrencyV1;
  stress: RssStressV1;
  sampling: RssSamplingV1;
  pass_fail: RssPassFailV1;
  steps: string[];
}
