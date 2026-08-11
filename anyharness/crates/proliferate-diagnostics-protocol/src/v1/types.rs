use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct SchemaVersionV1 {
    pub major: u16,
    pub minor: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SeverityV1 {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordClassV1 {
    Detailed,
    Lifecycle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecyclePhaseV1 {
    Started,
    Terminal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalOutcomeV1 {
    Succeeded,
    Failed,
    Cancelled,
    TimedOut,
    Abandoned,
    Rejected,
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentV1 {
    DesktopRenderer,
    DesktopTauri,
    DiagnosticsCollector,
    Anyharness,
    DesktopWorker,
    Server,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceV1 {
    Renderer,
    Tauri,
    Collector,
    Anyharness,
    Worker,
    Server,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyClassificationV1 {
    Operational,
    CustomerContent,
    Sensitive,
    Secret,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RedactionClassificationV1 {
    None,
    Structural,
    SupportExport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectionReasonV1 {
    InvalidShape,
    RecordTooLarge,
    BatchTooLarge,
    UnsupportedMajor,
    UnsupportedMinor,
    ProhibitedSecret,
    ProhibitedMetadata,
    LimitExceeded,
    ConflictingTerminal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PressureV1 {
    Normal,
    Elevated,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GapReasonV1 {
    Evicted,
    ProducerSequence,
    TailLag,
    CollectorRestart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatusV1 {
    Starting,
    Ready,
    Degraded,
    Stopping,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProducerLivenessV1 {
    Attached,
    Alive,
    Dead,
    Incompatible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExporterStateV1 {
    Disabled,
    Ready,
    Degraded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FallbackStateV1 {
    Inactive,
    Active,
    Degraded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetailedKindV1 {
    Log,
    SpanEvent,
    Message,
    Stdio,
    TokenDelta,
    ItemDelta,
    Heartbeat,
    Progress,
    Transport,
    Milestone,
    LossSummary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StandardStreamV1 {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleFinalizerV1 {
    Producer,
    Collector,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetadataPhaseV1 {
    Prepare,
    Invoke,
    Stream,
    Complete,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum ArgumentValueV1 {
    String(String),
    Integer(i64),
    Float(f64),
    Boolean(bool),
    Enum(String),
    List(Vec<ArgumentValueV1>),
    Object(BTreeMap<String, ArgumentValueV1>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TypedArgumentV1 {
    pub name: String,
    pub privacy: PrivacyClassificationV1,
    pub value: ArgumentValueV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelMetadataV1 {
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<MetadataPhaseV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginMetadataV1 {
    pub plugin_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<MetadataPhaseV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DetailedDiagnosticV1 {
    pub kind: DetailedKindV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<StandardStreamV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dropped_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub milestone: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CanonicalLifecycleV1 {
    pub phase: LifecyclePhaseV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<TerminalOutcomeV1>,
    pub finalizer: LifecycleFinalizerV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelMetadataV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin: Option<PluginMetadataV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProducerRecordV1 {
    pub schema_version: SchemaVersionV1,
    pub source_timestamp: String,
    pub producer_sequence: u64,
    pub producer_boot_id: String,
    pub component: ComponentV1,
    pub source: SourceV1,
    pub release: String,
    pub environment: String,
    pub operation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,
    pub name: String,
    pub severity: SeverityV1,
    pub arguments: Vec<TypedArgumentV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_classification: Option<String>,
    pub record_class: RecordClassV1,
    pub privacy: PrivacyClassificationV1,
    pub redaction: RedactionClassificationV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detailed: Option<DetailedDiagnosticV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<CanonicalLifecycleV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollectorAcceptedRecordV1 {
    pub record: ProducerRecordV1,
    pub accepted_timestamp: String,
    pub accepted_order: u64,
    pub retention_cursor: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenReferenceKindV1 {
    InheritedFileDescriptor,
    ProcessMemory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtectedTokenReferenceV1 {
    pub kind: TokenReferenceKindV1,
    pub reference: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionDescriptorV1 {
    pub endpoint: String,
    pub token_reference: ProtectedTokenReferenceV1,
    pub schema_major: u16,
    pub collector_boot_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IngestBatchV1 {
    pub schema_version: SchemaVersionV1,
    pub records: Vec<ProducerRecordV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AcceptedOrderRangeV1 {
    pub first: u64,
    pub last: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IngestRejectionV1 {
    pub index: u16,
    pub reason: RejectionReasonV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IngestReceiptV1 {
    pub schema_version: SchemaVersionV1,
    pub collector_boot_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepted_range: Option<AcceptedOrderRangeV1>,
    pub accepted_count: u16,
    pub duplicate_count: u16,
    pub rejections: Vec<IngestRejectionV1>,
    pub pressure: PressureV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordsFilterV1 {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_time_from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_time_to: Option<String>,
    pub components: Vec<ComponentV1>,
    pub record_classes: Vec<RecordClassV1>,
    pub severities: Vec<SeverityV1>,
    pub names: Vec<String>,
    pub outcomes: Vec<TerminalOutcomeV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_classification: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordsQueryV1 {
    pub schema_version: SchemaVersionV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_cursor: Option<u64>,
    pub limit: u16,
    pub filters: RecordsFilterV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GapV1 {
    pub reason: GapReasonV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_cursor: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_cursor: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component: Option<ComponentV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub producer_boot_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_sequence_from: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_sequence_to: Option<u64>,
    pub dropped_records: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionCountV1 {
    pub version: SchemaVersionV1,
    pub records: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordsPageV1 {
    pub schema_version: SchemaVersionV1,
    pub records: Vec<CollectorAcceptedRecordV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<u64>,
    pub gaps: Vec<GapV1>,
    pub versions_present: Vec<VersionCountV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "frame", rename_all = "snake_case")]
pub enum TailFrameV1 {
    Records {
        records: Vec<CollectorAcceptedRecordV1>,
        cursor: u64,
    },
    Lag {
        dropped_frames: u64,
        resume_after_cursor: u64,
    },
    Gap {
        gap: GapV1,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportPurposeV1 {
    Support,
    InternalDogfood,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportRequestV1 {
    pub schema_version: SchemaVersionV1,
    pub purpose: ExportPurposeV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub support_authorization_id: Option<String>,
    pub filters: RecordsFilterV1,
    pub record_limit: u32,
    pub byte_limit: u64,
    pub include_health: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportManifestV1 {
    pub schema_version: SchemaVersionV1,
    pub snapshot_id: String,
    pub generated_at: String,
    pub record_count: u32,
    pub byte_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_start: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_end: Option<u64>,
    pub gaps: Vec<GapV1>,
    pub versions_present: Vec<VersionCountV1>,
    pub filters: RecordsFilterV1,
    pub redaction: RedactionClassificationV1,
    pub includes_health: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "frame", rename_all = "snake_case")]
pub enum ExportStreamFrameV1 {
    Manifest { manifest: ExportManifestV1 },
    Record { record: CollectorAcceptedRecordV1 },
    Gap { gap: GapV1 },
    Health { health: HealthResponseV1 },
    End { records: u32, bytes: u64 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProducerHealthV1 {
    pub component: ComponentV1,
    pub producer_boot_id: String,
    pub schema_version: SchemaVersionV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sequence: Option<u64>,
    pub gap_count: u64,
    pub liveness: ProducerLivenessV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExporterHealthV1 {
    pub state: ExporterStateV1,
    pub dropped_records: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error_classification: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FallbackHealthV1 {
    pub state: FallbackStateV1,
    pub bytes: u64,
    pub dropped_records: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HealthResponseV1 {
    pub schema_version: SchemaVersionV1,
    pub status: HealthStatusV1,
    pub collector_boot_id: String,
    pub restart_count: u64,
    pub pressure: PressureV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oldest_cursor: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub newest_cursor: Option<u64>,
    pub retained_bytes: u64,
    pub evictions_by_class: BTreeMap<RecordClassV1, u64>,
    pub evictions_by_component: BTreeMap<ComponentV1, u64>,
    pub evictions_by_reason: BTreeMap<GapReasonV1, u64>,
    pub rejections_by_reason: BTreeMap<RejectionReasonV1, u64>,
    pub cardinality_counts: BTreeMap<String, u64>,
    pub rejected_records: u64,
    pub oversized_records: u64,
    pub duplicate_terminals: u64,
    pub conflicting_terminals: u64,
    pub producers: Vec<ProducerHealthV1>,
    pub tail_reader_drops: u64,
    pub exporter: ExporterHealthV1,
    pub fallback: FallbackHealthV1,
}

include!("types_rss.rs");
