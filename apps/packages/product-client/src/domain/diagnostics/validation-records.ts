import type {
  CollectorAcceptedRecordV1,
  ConnectionDescriptorV1,
  IngestBatchV1,
  IngestReceiptV1,
  PressureV1,
  ProducerRecordV1,
  TokenReferenceKindV1,
} from "./contract";
import {
  CURRENT_SCHEMA_VERSION,
  MAX_ARGUMENTS,
  MAX_BATCH_BYTES,
  MAX_BATCH_RECORDS,
  MAX_RECORD_BYTES,
} from "./limits";
import {
  canonicalClone,
  fail,
  jsonByteLength,
  optionalId,
  optionalName,
  requireArray,
  requireEnum,
  requireId,
  requireName,
  requireNonnegativeInteger,
  requireObject,
  requireShortString,
  requireString,
  requireTimestamp,
} from "./validation-scalars";
import {
  parseDetailed,
  parseLifecycle,
  parseSchemaVersion,
  parseTypedArgument,
  rejectProhibitedModelPluginMetadata,
  rejectSecretFields,
} from "./validation-support";
import {
  COMPONENTS,
  PRIVACY,
  RECORD_CLASSES,
  REDACTION,
  REJECTION_REASONS,
  SEVERITIES,
  SOURCES,
} from "./validation-vocabulary";

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
