import type {
  CollectorAcceptedRecordV1,
  ConnectionDescriptorV1,
  ExportPurposeV1,
  ExporterStateV1,
  ExportManifestV1,
  ExportRequestV1,
  ExportStreamFrameV1,
  FallbackStateV1,
  HealthResponseV1,
  HealthStatusV1,
  IngestBatchV1,
  IngestReceiptV1,
  PressureV1,
  ProducerRecordV1,
  ProducerLivenessV1,
  RecordsPageV1,
  RecordsQueryV1,
  RssMeasurementProfileV1,
  TailFrameV1,
  TokenReferenceKindV1,
} from "./contract";
import {
  COLLECTOR_TOTAL_RSS_LIMIT_BYTES,
  CURRENT_SCHEMA_VERSION,
  MAX_ARGUMENT_LIST_ITEMS,
  MAX_ARGUMENTS,
  MAX_BATCH_BYTES,
  MAX_BATCH_RECORDS,
  MAX_CARDINALITY_ENTRIES,
  MAX_EXPORT_BYTES,
  MAX_EXPORT_RECORDS,
  MAX_HEALTH_PRODUCERS,
  MAX_PAGE_RECORDS,
  MAX_RECORD_BYTES,
  MAX_STRING_BYTES,
  MAX_TAIL_FRAME_RECORDS,
  MAX_VERSIONS_PRESENT,
  RETAINED_RECORD_ARENA_LIMIT_BYTES,
} from "./limits";
import {
  COMPONENTS,
  PRIVACY,
  RECORD_CLASSES,
  REDACTION,
  REJECTION_REASONS,
  SEVERITIES,
  SOURCES,
  canonicalClone,
  fail,
  jsonByteLength,
  optionalId,
  optionalName,
  optionalNonnegativeInteger,
  parseDetailed,
  parseFilters,
  parseGap,
  parseLifecycle,
  parseSchemaVersion,
  parseTypedArgument,
  parseVersionCount,
  rejectProhibitedModelPluginMetadata,
  rejectSecretFields,
  requireArray,
  requireBoolean,
  requireBoundedString,
  requireEnum,
  requireId,
  requireName,
  requireNonnegativeInteger,
  requireObject,
  requirePositiveInteger,
  requireShortString,
  requireString,
  requireTimestamp,
  validateCountMap,
} from "./validation-support";

export function parseProducerRecordV1(input: unknown): ProducerRecordV1 {
  const raw = requireObject(input);
  if (jsonByteLength(raw) > MAX_RECORD_BYTES) {
    fail("record_too_large");
  }
  rejectSecretFields(raw);
  rejectProhibitedModelPluginMetadata(raw);

  const schemaVersion = parseSchemaVersion(raw.schema_version);
  const recordClass = requireEnum(raw.record_class, RECORD_CLASSES);
  const privacy = requireEnum(raw.privacy, PRIVACY);
  if (privacy === "secret") {
    fail("prohibited_secret");
  }

  const argumentsValue = requireArray(raw.arguments);
  if (argumentsValue.length > MAX_ARGUMENTS) {
    fail("limit_exceeded");
  }
  const args = argumentsValue.map(parseTypedArgument);
  const name = requireName(raw.name);
  const errorClassification = optionalName(raw.error_classification);
  const detailed =
    raw.detailed === undefined || raw.detailed === null
      ? undefined
      : parseDetailed(raw.detailed);
  const lifecycle =
    raw.lifecycle === undefined || raw.lifecycle === null
      ? undefined
      : parseLifecycle(raw.lifecycle, name);

  if (
    (recordClass === "detailed" && (detailed === undefined || lifecycle !== undefined)) ||
    (recordClass === "lifecycle" && (lifecycle === undefined || detailed !== undefined))
  ) {
    fail("invalid_shape");
  }
  if (
    lifecycle?.phase === "terminal" &&
    lifecycle.outcome === "failed" &&
    errorClassification === undefined
  ) {
    fail("invalid_shape");
  }

  const record: ProducerRecordV1 = {
    schema_version: schemaVersion,
    source_timestamp: requireTimestamp(raw.source_timestamp),
    producer_sequence: requireNonnegativeInteger(raw.producer_sequence),
    producer_boot_id: requireId(raw.producer_boot_id),
    component: requireEnum(raw.component, COMPONENTS),
    source: requireEnum(raw.source, SOURCES),
    release: requireShortString(raw.release),
    environment: requireShortString(raw.environment),
    operation_id: requireId(raw.operation_id),
    parent_operation_id: optionalId(raw.parent_operation_id),
    trace_id: optionalId(raw.trace_id),
    workspace_id: optionalId(raw.workspace_id),
    session_id: optionalId(raw.session_id),
    turn_id: optionalId(raw.turn_id),
    item_id: optionalId(raw.item_id),
    request_id: optionalId(raw.request_id),
    target_id: optionalId(raw.target_id),
    prompt_id: optionalId(raw.prompt_id),
    workflow_id: optionalId(raw.workflow_id),
    name,
    severity: requireEnum(raw.severity, SEVERITIES),
    arguments: args,
    error_classification: errorClassification,
    record_class: recordClass,
    privacy,
    redaction: requireEnum(raw.redaction, REDACTION),
    detailed,
    lifecycle,
  };
  return canonicalClone(record);
}

export function parseConnectionDescriptorV1(input: unknown): ConnectionDescriptorV1 {
  const raw = requireObject(input);
  rejectSecretFields(raw);
  if (raw.schema_major !== CURRENT_SCHEMA_VERSION.major) {
    fail("unsupported_major");
  }
  const endpoint = requireString(raw.endpoint);
  const endpointMatch = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(endpoint);
  if (endpointMatch === null || Number(endpointMatch[1]) > 65_535) {
    fail("invalid_shape");
  }
  const tokenReference = requireObject(raw.token_reference);
  const kind = requireEnum(
    tokenReference.kind,
    new Set<TokenReferenceKindV1>(["inherited_file_descriptor", "process_memory"]),
  );
  const reference = requireId(tokenReference.reference);
  if (kind === "inherited_file_descriptor") {
    if (!/^[0-9]+$/.test(reference) || Number(reference) > 4_294_967_295) {
      fail("invalid_shape");
    }
  }
  return {
    endpoint,
    token_reference: { kind, reference },
    schema_major: CURRENT_SCHEMA_VERSION.major,
    collector_boot_id: requireId(raw.collector_boot_id),
  };
}

export function parseIngestBatchV1(input: unknown): IngestBatchV1 {
  const raw = requireObject(input);
  if (jsonByteLength(raw) > MAX_BATCH_BYTES) {
    fail("batch_too_large");
  }
  const records = requireArray(raw.records);
  if (records.length > MAX_BATCH_RECORDS) {
    fail("batch_too_large");
  }
  return {
    schema_version: parseSchemaVersion(raw.schema_version),
    records: records.map(parseProducerRecordV1),
  };
}

export function parseIngestReceiptV1(input: unknown): IngestReceiptV1 {
  const raw = requireObject(input);
  const rejections = requireArray(raw.rejections);
  if (rejections.length > MAX_BATCH_RECORDS) {
    fail("limit_exceeded");
  }
  const acceptedRange =
    raw.accepted_range === undefined || raw.accepted_range === null
      ? undefined
      : (() => {
          const range = requireObject(raw.accepted_range);
          return {
            first: requireNonnegativeInteger(range.first),
            last: requireNonnegativeInteger(range.last),
          };
        })();
  return canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    collector_boot_id: requireId(raw.collector_boot_id),
    accepted_range: acceptedRange,
    accepted_count: requireNonnegativeInteger(raw.accepted_count),
    duplicate_count: requireNonnegativeInteger(raw.duplicate_count),
    rejections: rejections.map((value) => {
      const rejection = requireObject(value);
      return {
        index: requireNonnegativeInteger(rejection.index),
        reason: requireEnum(rejection.reason, REJECTION_REASONS),
      };
    }),
    pressure: requireEnum(
      raw.pressure,
      new Set<PressureV1>(["normal", "elevated", "critical"]),
    ),
  });
}

export function parseCollectorAcceptedRecordV1(
  input: unknown,
): CollectorAcceptedRecordV1 {
  const raw = requireObject(input);
  return {
    record: parseProducerRecordV1(raw.record),
    accepted_timestamp: requireTimestamp(raw.accepted_timestamp),
    accepted_order: requireNonnegativeInteger(raw.accepted_order),
    retention_cursor: requireNonnegativeInteger(raw.retention_cursor),
  };
}

export function parseRecordsQueryV1(input: unknown): RecordsQueryV1 {
  const raw = requireObject(input);
  const limit = requirePositiveInteger(raw.limit);
  if (limit > MAX_PAGE_RECORDS) {
    fail("limit_exceeded");
  }
  return canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    after_cursor: optionalNonnegativeInteger(raw.after_cursor),
    limit,
    filters: parseFilters(raw.filters),
  });
}

export function parseRecordsPageV1(input: unknown): RecordsPageV1 {
  const raw = requireObject(input);
  const records = requireArray(raw.records);
  const gaps = requireArray(raw.gaps);
  const versions = requireArray(raw.versions_present);
  if (
    records.length > MAX_PAGE_RECORDS ||
    gaps.length > MAX_CARDINALITY_ENTRIES ||
    versions.length > MAX_VERSIONS_PRESENT
  ) {
    fail("limit_exceeded");
  }
  return canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    records: records.map(parseCollectorAcceptedRecordV1),
    next_cursor: optionalNonnegativeInteger(raw.next_cursor),
    gaps: gaps.map(parseGap),
    versions_present: versions.map(parseVersionCount),
  });
}

export function parseTailFrameV1(input: unknown): TailFrameV1 {
  const raw = requireObject(input);
  if (raw.frame === "records") {
    const records = requireArray(raw.records);
    if (records.length > MAX_TAIL_FRAME_RECORDS) {
      fail("limit_exceeded");
    }
    return {
      frame: "records",
      records: records.map(parseCollectorAcceptedRecordV1),
      cursor: requireNonnegativeInteger(raw.cursor),
    };
  }
  if (raw.frame === "lag") {
    return {
      frame: "lag",
      dropped_frames: requireNonnegativeInteger(raw.dropped_frames),
      resume_after_cursor: requireNonnegativeInteger(raw.resume_after_cursor),
    };
  }
  if (raw.frame === "gap") {
    return { frame: "gap", gap: parseGap(raw.gap) };
  }
  fail("invalid_shape");
}

export function parseExportRequestV1(input: unknown): ExportRequestV1 {
  const raw = requireObject(input);
  const purpose = requireEnum(
    raw.purpose,
    new Set<ExportPurposeV1>(["support", "internal_dogfood"]),
  );
  const authorization = optionalId(raw.support_authorization_id);
  if (
    (purpose === "support" && authorization === undefined) ||
    (purpose === "internal_dogfood" && authorization !== undefined)
  ) {
    fail("invalid_shape");
  }
  const recordLimit = requirePositiveInteger(raw.record_limit);
  const byteLimit = requirePositiveInteger(raw.byte_limit);
  if (recordLimit > MAX_EXPORT_RECORDS || byteLimit > MAX_EXPORT_BYTES) {
    fail("limit_exceeded");
  }
  return canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    purpose,
    support_authorization_id: authorization,
    filters: parseFilters(raw.filters),
    record_limit: recordLimit,
    byte_limit: byteLimit,
    include_health: requireBoolean(raw.include_health),
  });
}

export function parseExportManifestV1(input: unknown): ExportManifestV1 {
  const raw = requireObject(input);
  const recordCount = requireNonnegativeInteger(raw.record_count);
  const byteCount = requireNonnegativeInteger(raw.byte_count);
  const gaps = requireArray(raw.gaps);
  const versions = requireArray(raw.versions_present);
  if (
    recordCount > MAX_EXPORT_RECORDS ||
    byteCount > MAX_EXPORT_BYTES ||
    gaps.length > MAX_CARDINALITY_ENTRIES ||
    versions.length > MAX_VERSIONS_PRESENT
  ) {
    fail("limit_exceeded");
  }
  return canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    snapshot_id: requireId(raw.snapshot_id),
    generated_at: requireTimestamp(raw.generated_at),
    record_count: recordCount,
    byte_count: byteCount,
    cursor_start: optionalNonnegativeInteger(raw.cursor_start),
    cursor_end: optionalNonnegativeInteger(raw.cursor_end),
    gaps: gaps.map(parseGap),
    versions_present: versions.map(parseVersionCount),
    filters: parseFilters(raw.filters),
    redaction: requireEnum(raw.redaction, REDACTION),
    includes_health: requireBoolean(raw.includes_health),
  });
}

export function parseExportStreamFrameV1(input: unknown): ExportStreamFrameV1 {
  const raw = requireObject(input);
  switch (raw.frame) {
    case "manifest":
      return { frame: "manifest", manifest: parseExportManifestV1(raw.manifest) };
    case "record":
      return { frame: "record", record: parseCollectorAcceptedRecordV1(raw.record) };
    case "gap":
      return { frame: "gap", gap: parseGap(raw.gap) };
    case "health":
      return { frame: "health", health: parseHealthResponseV1(raw.health) };
    case "end":
      return {
        frame: "end",
        records: requireNonnegativeInteger(raw.records),
        bytes: requireNonnegativeInteger(raw.bytes),
      };
    default:
      fail("invalid_shape");
  }
}

export function parseHealthResponseV1(input: unknown): HealthResponseV1 {
  const raw = requireObject(input);
  const retainedBytes = requireNonnegativeInteger(raw.retained_bytes);
  const producers = requireArray(raw.producers);
  const maps = [
    requireObject(raw.evictions_by_class),
    requireObject(raw.evictions_by_component),
    requireObject(raw.evictions_by_reason),
    requireObject(raw.rejections_by_reason),
    requireObject(raw.cardinality_counts),
  ];
  if (
    retainedBytes > RETAINED_RECORD_ARENA_LIMIT_BYTES ||
    producers.length > MAX_HEALTH_PRODUCERS ||
    maps.some((value) => Object.keys(value).length > MAX_CARDINALITY_ENTRIES)
  ) {
    fail("limit_exceeded");
  }
  validateCountMap(maps[0], RECORD_CLASSES);
  validateCountMap(maps[1], COMPONENTS);
  validateCountMap(
    maps[2],
    new Set(["evicted", "producer_sequence", "tail_lag", "collector_restart"]),
  );
  validateCountMap(maps[3], REJECTION_REASONS);
  validateCountMap(maps[4]);
  Object.keys(maps[4]).forEach(requireName);
  const exporter = requireObject(raw.exporter);
  const fallback = requireObject(raw.fallback);
  return canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    status: requireEnum(
      raw.status,
      new Set<HealthStatusV1>(["starting", "ready", "degraded", "stopping"]),
    ),
    collector_boot_id: requireId(raw.collector_boot_id),
    restart_count: requireNonnegativeInteger(raw.restart_count),
    pressure: requireEnum(
      raw.pressure,
      new Set<PressureV1>(["normal", "elevated", "critical"]),
    ),
    oldest_cursor: optionalNonnegativeInteger(raw.oldest_cursor),
    newest_cursor: optionalNonnegativeInteger(raw.newest_cursor),
    retained_bytes: retainedBytes,
    evictions_by_class: maps[0],
    evictions_by_component: maps[1],
    evictions_by_reason: maps[2],
    rejections_by_reason: maps[3],
    cardinality_counts: maps[4],
    rejected_records: requireNonnegativeInteger(raw.rejected_records),
    oversized_records: requireNonnegativeInteger(raw.oversized_records),
    duplicate_terminals: requireNonnegativeInteger(raw.duplicate_terminals),
    conflicting_terminals: requireNonnegativeInteger(raw.conflicting_terminals),
    producers: producers.map((value) => {
      const producer = requireObject(value);
      return {
        component: requireEnum(producer.component, COMPONENTS),
        producer_boot_id: requireId(producer.producer_boot_id),
        schema_version: parseSchemaVersion(producer.schema_version),
        last_sequence: optionalNonnegativeInteger(producer.last_sequence),
        gap_count: requireNonnegativeInteger(producer.gap_count),
        liveness: requireEnum(
          producer.liveness,
          new Set<ProducerLivenessV1>(["attached", "alive", "dead", "incompatible"]),
        ),
      };
    }),
    tail_reader_drops: requireNonnegativeInteger(raw.tail_reader_drops),
    exporter: {
      state: requireEnum(
        exporter.state,
        new Set<ExporterStateV1>(["disabled", "ready", "degraded"]),
      ),
      dropped_records: requireNonnegativeInteger(exporter.dropped_records),
      last_error_classification: optionalName(exporter.last_error_classification),
    },
    fallback: {
      state: requireEnum(
        fallback.state,
        new Set<FallbackStateV1>(["inactive", "active", "degraded"]),
      ),
      bytes: requireNonnegativeInteger(fallback.bytes),
      dropped_records: requireNonnegativeInteger(fallback.dropped_records),
    },
  } as HealthResponseV1);
}

export function parseRssMeasurementProfileV1(input: unknown): RssMeasurementProfileV1 {
  const raw = requireObject(input);
  const warmup = requireObject(raw.warmup);
  const concurrency = requireObject(raw.concurrency);
  const stress = requireObject(raw.stress);
  const sampling = requireObject(raw.sampling);
  const passFail = requireObject(raw.pass_fail);
  const targets = requireArray(raw.targets).map(requireString);
  const requiredConditions = requireArray(passFail.required_conditions).map(requireString);
  const steps = requireArray(raw.steps).map(requireString);
  const required = [
    "warm_up",
    "concurrent_ingest",
    "concurrent_query",
    "concurrent_tail",
    "concurrent_export",
    "oversized_input",
    "slow_reader",
    "failed_exporter",
    "sample_total_rss",
    "assert_responsive",
    "assert_counters_and_gaps",
  ];
  if (
    JSON.stringify(targets) !==
      JSON.stringify(["aarch64-apple-darwin", "x86_64-apple-darwin"]) ||
    raw.build_profile !== "release" ||
    passFail.total_rss_limit_bytes !== COLLECTOR_TOTAL_RSS_LIMIT_BYTES ||
    passFail.retained_arena_limit_bytes !== RETAINED_RECORD_ARENA_LIMIT_BYTES ||
    RETAINED_RECORD_ARENA_LIMIT_BYTES >= COLLECTOR_TOTAL_RSS_LIMIT_BYTES ||
    JSON.stringify(requiredConditions) !== JSON.stringify(required) ||
    steps.length === 0 ||
    steps.length > MAX_ARGUMENT_LIST_ITEMS
  ) {
    fail("invalid_shape");
  }
  const profile: RssMeasurementProfileV1 = canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    targets,
    build_profile: "release",
    warmup: {
      duration_seconds: requirePositiveInteger(warmup.duration_seconds),
      records: requirePositiveInteger(warmup.records),
    },
    concurrency: {
      ingest_writers: requirePositiveInteger(concurrency.ingest_writers),
      query_readers: requirePositiveInteger(concurrency.query_readers),
      tail_readers: requirePositiveInteger(concurrency.tail_readers),
      export_readers: requirePositiveInteger(concurrency.export_readers),
    },
    stress: {
      duration_seconds: requirePositiveInteger(stress.duration_seconds),
      records_per_second: requirePositiveInteger(stress.records_per_second),
      oversized_record_every: requirePositiveInteger(stress.oversized_record_every),
      slow_tail_delay_ms: requirePositiveInteger(stress.slow_tail_delay_ms),
      fail_exporter_after_records: requirePositiveInteger(
        stress.fail_exporter_after_records,
      ),
    },
    sampling: {
      interval_ms: requirePositiveInteger(sampling.interval_ms),
      command_template: requireBoundedString(sampling.command_template, MAX_STRING_BYTES),
      samples_output: requireBoundedString(sampling.samples_output, MAX_STRING_BYTES),
    },
    pass_fail: {
      total_rss_limit_bytes: COLLECTOR_TOTAL_RSS_LIMIT_BYTES,
      retained_arena_limit_bytes: RETAINED_RECORD_ARENA_LIMIT_BYTES,
      required_conditions: requiredConditions,
    },
    steps: steps.map((step) => requireBoundedString(step, MAX_STRING_BYTES)),
  });
  return profile;
}
