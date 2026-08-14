from typing import Literal, NotRequired, TypedDict

type SeverityV1 = Literal["trace", "debug", "info", "warn", "error"]
type RecordClassV1 = Literal["detailed", "lifecycle"]
type LifecyclePhaseV1 = Literal["started", "terminal"]
type TerminalOutcomeV1 = Literal[
    "succeeded", "failed", "cancelled", "timed_out", "abandoned", "rejected", "skipped"
]
type ComponentV1 = Literal[
    "desktop_renderer",
    "desktop_tauri",
    "diagnostics_collector",
    "anyharness",
    "desktop_worker",
    "server",
]
type SourceV1 = Literal["renderer", "tauri", "collector", "anyharness", "worker", "server"]
type PrivacyClassificationV1 = Literal["operational", "customer_content", "sensitive", "secret"]
type RedactionClassificationV1 = Literal["none", "structural", "support_export"]
type RejectionReasonV1 = Literal[
    "invalid_shape",
    "record_too_large",
    "batch_too_large",
    "unsupported_major",
    "unsupported_minor",
    "prohibited_secret",
    "prohibited_metadata",
    "limit_exceeded",
    "conflicting_terminal",
]
type PressureV1 = Literal["normal", "elevated", "critical"]
type GapReasonV1 = Literal["evicted", "producer_sequence", "tail_lag", "collector_restart"]
type HealthStatusV1 = Literal["starting", "ready", "degraded", "stopping"]
type ProducerLivenessV1 = Literal["attached", "alive", "dead", "incompatible"]
type ExporterStateV1 = Literal["disabled", "ready", "degraded"]
type FallbackStateV1 = Literal["inactive", "active", "degraded"]
type DetailedKindV1 = Literal[
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
]
type StandardStreamV1 = Literal["stdout", "stderr"]
type LifecycleFinalizerV1 = Literal["producer", "collector"]
type MetadataPhaseV1 = Literal["prepare", "invoke", "stream", "complete"]


class SchemaVersionV1(TypedDict):
    major: int
    minor: int


class StringArgumentValueV1(TypedDict):
    type: Literal["string"]
    value: str


class IntegerArgumentValueV1(TypedDict):
    type: Literal["integer"]
    value: int


class FloatArgumentValueV1(TypedDict):
    type: Literal["float"]
    value: float


class BooleanArgumentValueV1(TypedDict):
    type: Literal["boolean"]
    value: bool


class EnumArgumentValueV1(TypedDict):
    type: Literal["enum"]
    value: str


class ListArgumentValueV1(TypedDict):
    type: Literal["list"]
    value: list["ArgumentValueV1"]


class ObjectArgumentValueV1(TypedDict):
    type: Literal["object"]
    value: dict[str, "ArgumentValueV1"]


type ArgumentValueV1 = (
    StringArgumentValueV1
    | IntegerArgumentValueV1
    | FloatArgumentValueV1
    | BooleanArgumentValueV1
    | EnumArgumentValueV1
    | ListArgumentValueV1
    | ObjectArgumentValueV1
)


class TypedArgumentV1(TypedDict):
    name: str
    privacy: PrivacyClassificationV1
    value: ArgumentValueV1


class ModelMetadataV1(TypedDict):
    model_id: str
    provider_kind: NotRequired[str]
    phase: NotRequired[MetadataPhaseV1]
    input_tokens: NotRequired[int]
    output_tokens: NotRequired[int]
    duration_ms: NotRequired[int]


class PluginMetadataV1(TypedDict):
    plugin_id: str
    kind: NotRequired[str]
    phase: NotRequired[MetadataPhaseV1]
    duration_ms: NotRequired[int]


class DetailedDiagnosticV1(TypedDict):
    kind: DetailedKindV1
    message: NotRequired[str]
    stream: NotRequired[StandardStreamV1]
    dropped_count: NotRequired[int]
    milestone: NotRequired[str]


class CanonicalLifecycleV1(TypedDict):
    phase: LifecyclePhaseV1
    outcome: NotRequired[TerminalOutcomeV1]
    finalizer: LifecycleFinalizerV1
    model: NotRequired[ModelMetadataV1]
    plugin: NotRequired[PluginMetadataV1]


class ProducerRecordV1(TypedDict):
    schema_version: SchemaVersionV1
    source_timestamp: str
    producer_sequence: int
    producer_boot_id: str
    component: ComponentV1
    source: SourceV1
    release: str
    environment: str
    operation_id: str
    parent_operation_id: NotRequired[str]
    trace_id: NotRequired[str]
    workspace_id: NotRequired[str]
    session_id: NotRequired[str]
    turn_id: NotRequired[str]
    item_id: NotRequired[str]
    request_id: NotRequired[str]
    target_id: NotRequired[str]
    prompt_id: NotRequired[str]
    workflow_id: NotRequired[str]
    name: str
    severity: SeverityV1
    arguments: list[TypedArgumentV1]
    error_classification: NotRequired[str]
    record_class: RecordClassV1
    privacy: PrivacyClassificationV1
    redaction: RedactionClassificationV1
    detailed: NotRequired[DetailedDiagnosticV1]
    lifecycle: NotRequired[CanonicalLifecycleV1]


class CollectorAcceptedRecordV1(TypedDict):
    record: ProducerRecordV1
    accepted_timestamp: str
    accepted_order: int
    retention_cursor: int


type TokenReferenceKindV1 = Literal["inherited_file_descriptor", "process_memory"]


class ProtectedTokenReferenceV1(TypedDict):
    kind: TokenReferenceKindV1
    reference: str


class ConnectionDescriptorV1(TypedDict):
    endpoint: str
    token_reference: ProtectedTokenReferenceV1
    schema_major: int
    collector_boot_id: str


class IngestBatchV1(TypedDict):
    schema_version: SchemaVersionV1
    records: list[ProducerRecordV1]


class AcceptedOrderRangeV1(TypedDict):
    first: int
    last: int


class IngestRejectionV1(TypedDict):
    index: int
    reason: RejectionReasonV1


class IngestReceiptV1(TypedDict):
    schema_version: SchemaVersionV1
    collector_boot_id: str
    accepted_range: NotRequired[AcceptedOrderRangeV1]
    accepted_count: int
    duplicate_count: int
    rejections: list[IngestRejectionV1]
    pressure: PressureV1


class RecordsFilterV1(TypedDict):
    source_time_from: NotRequired[str]
    source_time_to: NotRequired[str]
    components: list[ComponentV1]
    record_classes: list[RecordClassV1]
    severities: list[SeverityV1]
    names: list[str]
    outcomes: list[TerminalOutcomeV1]
    operation_id: NotRequired[str]
    parent_operation_id: NotRequired[str]
    trace_id: NotRequired[str]
    workspace_id: NotRequired[str]
    session_id: NotRequired[str]
    turn_id: NotRequired[str]
    item_id: NotRequired[str]
    request_id: NotRequired[str]
    target_id: NotRequired[str]
    prompt_id: NotRequired[str]
    workflow_id: NotRequired[str]
    error_classification: NotRequired[str]


class RecordsQueryV1(TypedDict):
    schema_version: SchemaVersionV1
    after_cursor: NotRequired[int]
    limit: int
    filters: RecordsFilterV1


class GapV1(TypedDict):
    reason: GapReasonV1
    from_cursor: NotRequired[int]
    to_cursor: NotRequired[int]
    component: NotRequired[ComponentV1]
    producer_boot_id: NotRequired[str]
    missing_sequence_from: NotRequired[int]
    missing_sequence_to: NotRequired[int]
    dropped_records: int


class VersionCountV1(TypedDict):
    version: SchemaVersionV1
    records: int


class RecordsPageV1(TypedDict):
    schema_version: SchemaVersionV1
    records: list[CollectorAcceptedRecordV1]
    next_cursor: NotRequired[int]
    gaps: list[GapV1]
    versions_present: list[VersionCountV1]


class TailRecordsFrameV1(TypedDict):
    frame: Literal["records"]
    records: list[CollectorAcceptedRecordV1]
    cursor: int


class TailLagFrameV1(TypedDict):
    frame: Literal["lag"]
    dropped_frames: int
    resume_after_cursor: int


class TailGapFrameV1(TypedDict):
    frame: Literal["gap"]
    gap: GapV1


type TailFrameV1 = TailRecordsFrameV1 | TailLagFrameV1 | TailGapFrameV1
type ExportPurposeV1 = Literal["support", "internal_dogfood"]


class ExportRequestV1(TypedDict):
    schema_version: SchemaVersionV1
    purpose: ExportPurposeV1
    support_authorization_id: NotRequired[str]
    filters: RecordsFilterV1
    record_limit: int
    byte_limit: int
    include_health: bool


class ExportManifestV1(TypedDict):
    schema_version: SchemaVersionV1
    snapshot_id: str
    generated_at: str
    record_count: int
    byte_count: int
    cursor_start: NotRequired[int]
    cursor_end: NotRequired[int]
    gaps: list[GapV1]
    versions_present: list[VersionCountV1]
    filters: RecordsFilterV1
    redaction: RedactionClassificationV1
    includes_health: bool


class ProducerHealthV1(TypedDict):
    component: ComponentV1
    producer_boot_id: str
    schema_version: SchemaVersionV1
    last_sequence: NotRequired[int]
    gap_count: int
    liveness: ProducerLivenessV1


class ExporterHealthV1(TypedDict):
    state: ExporterStateV1
    dropped_records: int
    last_error_classification: NotRequired[str]


class FallbackHealthV1(TypedDict):
    state: FallbackStateV1
    bytes: int
    dropped_records: int


class HealthResponseV1(TypedDict):
    schema_version: SchemaVersionV1
    status: HealthStatusV1
    collector_boot_id: str
    restart_count: int
    pressure: PressureV1
    oldest_cursor: NotRequired[int]
    newest_cursor: NotRequired[int]
    retained_bytes: int
    evictions_by_class: dict[RecordClassV1, int]
    evictions_by_component: dict[ComponentV1, int]
    evictions_by_reason: dict[GapReasonV1, int]
    rejections_by_reason: dict[RejectionReasonV1, int]
    cardinality_counts: dict[str, int]
    rejected_records: int
    oversized_records: int
    duplicate_terminals: int
    conflicting_terminals: int
    producers: list[ProducerHealthV1]
    tail_reader_drops: int
    exporter: ExporterHealthV1
    fallback: FallbackHealthV1


class ExportManifestFrameV1(TypedDict):
    frame: Literal["manifest"]
    manifest: ExportManifestV1


class ExportRecordFrameV1(TypedDict):
    frame: Literal["record"]
    record: CollectorAcceptedRecordV1


class ExportGapFrameV1(TypedDict):
    frame: Literal["gap"]
    gap: GapV1


class ExportHealthFrameV1(TypedDict):
    frame: Literal["health"]
    health: HealthResponseV1


class ExportEndFrameV1(TypedDict):
    frame: Literal["end"]
    records: int
    bytes: int


type ExportStreamFrameV1 = (
    ExportManifestFrameV1
    | ExportRecordFrameV1
    | ExportGapFrameV1
    | ExportHealthFrameV1
    | ExportEndFrameV1
)


class RssWarmupV1(TypedDict):
    duration_seconds: int
    records: int


class RssConcurrencyV1(TypedDict):
    ingest_writers: int
    query_readers: int
    tail_readers: int
    export_readers: int


class RssStressV1(TypedDict):
    duration_seconds: int
    records_per_second: int
    oversized_record_every: int
    slow_tail_delay_ms: int
    fail_exporter_after_records: int


class RssSamplingV1(TypedDict):
    interval_ms: int
    command_template: str
    samples_output: str


class RssPassFailV1(TypedDict):
    total_rss_limit_bytes: int
    retained_arena_limit_bytes: int
    required_conditions: list[str]


class RssMeasurementProfileV1(TypedDict):
    schema_version: SchemaVersionV1
    targets: list[str]
    build_profile: str
    warmup: RssWarmupV1
    concurrency: RssConcurrencyV1
    stress: RssStressV1
    sampling: RssSamplingV1
    pass_fail: RssPassFailV1
    steps: list[str]
