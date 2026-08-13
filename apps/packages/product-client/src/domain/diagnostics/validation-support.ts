import { isP0Operation } from "./catalog";
import type {
  ArgumentValueV1,
  GapReasonV1,
  LifecycleFinalizerV1,
  LifecyclePhaseV1,
  ProducerRecordV1,
  RecordsFilterV1,
  SchemaVersionV1,
  StandardStreamV1,
  TypedArgumentV1,
} from "./contract";
import {
  CURRENT_SCHEMA_VERSION,
  MAX_ARGUMENT_DEPTH,
  MAX_ARGUMENT_LIST_ITEMS,
  MAX_ARGUMENT_OBJECT_FIELDS,
  MAX_FILTER_VALUES,
  MAX_MESSAGE_BYTES,
  MAX_STRING_BYTES,
  MIN_SUPPORTED_PRODUCER_MINOR,
} from "./limits";
import type { JsonObject } from "./validation-scalars";
import {
  canonicalClone,
  fail,
  isObject,
  optionalId,
  optionalName,
  optionalNonnegativeInteger,
  requireArray,
  requireBoolean,
  requireBoundedString,
  requireEnum,
  requireFiniteNumber,
  requireId,
  requireInteger,
  requireName,
  requireNonnegativeInteger,
  requireObject,
  requireString,
  requireTimestamp,
} from "./validation-scalars";
import {
  COMPONENTS,
  DETAILED_KINDS,
  METADATA_PHASES,
  PRIVACY,
  PROHIBITED_MODEL_PLUGIN_FIELDS,
  RECORD_CLASSES,
  SECRET_FIELD_NAMES,
  SEVERITIES,
  TERMINAL_OUTCOMES,
} from "./validation-vocabulary";

export function parseSchemaVersion(input: unknown): SchemaVersionV1 {
  const raw = requireObject(input);
  const major = requireNonnegativeInteger(raw.major);
  const minor = requireNonnegativeInteger(raw.minor);
  if (major !== CURRENT_SCHEMA_VERSION.major) {
    fail("unsupported_major");
  }
  if (minor < MIN_SUPPORTED_PRODUCER_MINOR || minor > CURRENT_SCHEMA_VERSION.minor) {
    fail("unsupported_minor");
  }
  return { major, minor };
}

export function parseTypedArgument(input: unknown): TypedArgumentV1 {
  const raw = requireObject(input);
  const privacy = requireEnum(raw.privacy, PRIVACY);
  if (privacy === "secret") {
    fail("prohibited_secret");
  }
  return {
    name: requireName(raw.name),
    privacy,
    value: parseArgumentValue(raw.value, 1),
  };
}

function parseArgumentValue(input: unknown, depth: number): ArgumentValueV1 {
  if (depth > MAX_ARGUMENT_DEPTH) {
    fail("limit_exceeded");
  }
  const raw = requireObject(input);
  const type = requireString(raw.type);
  switch (type) {
    case "string":
      return { type, value: requireBoundedString(raw.value, MAX_STRING_BYTES) };
    case "integer":
      return { type, value: requireInteger(raw.value) };
    case "float":
      return { type, value: requireFiniteNumber(raw.value) };
    case "boolean":
      return { type, value: requireBoolean(raw.value) };
    case "enum":
      return { type, value: requireName(raw.value) };
    case "list": {
      const values = requireArray(raw.value);
      if (values.length > MAX_ARGUMENT_LIST_ITEMS) {
        fail("limit_exceeded");
      }
      return { type, value: values.map((value) => parseArgumentValue(value, depth + 1)) };
    }
    case "object": {
      const value = requireObject(raw.value);
      if (Object.keys(value).length > MAX_ARGUMENT_OBJECT_FIELDS) {
        fail("limit_exceeded");
      }
      const parsed: Record<string, ArgumentValueV1> = {};
      for (const [key, nested] of Object.entries(value)) {
        requireName(key);
        parsed[key] = parseArgumentValue(nested, depth + 1);
      }
      return { type, value: parsed };
    }
    default:
      fail("invalid_shape");
  }
}

export function parseDetailed(input: unknown): ProducerRecordV1["detailed"] {
  const raw = requireObject(input);
  const kind = requireEnum(raw.kind, DETAILED_KINDS);
  const stream =
    raw.stream === undefined || raw.stream === null
      ? undefined
      : requireEnum(raw.stream, new Set<StandardStreamV1>(["stdout", "stderr"]));
  if ((kind === "stdio") !== (stream !== undefined)) {
    fail("invalid_shape");
  }
  return canonicalClone({
    kind,
    message:
      raw.message === undefined || raw.message === null
        ? undefined
        : requireBoundedString(raw.message, MAX_MESSAGE_BYTES),
    stream,
    dropped_count: optionalNonnegativeInteger(raw.dropped_count),
    milestone: optionalName(raw.milestone),
  });
}

export function parseLifecycle(
  input: unknown,
  operationName: string,
): ProducerRecordV1["lifecycle"] {
  const raw = requireObject(input);
  if (!isP0Operation(operationName)) {
    fail("invalid_shape");
  }
  const phase = requireEnum(
    raw.phase,
    new Set<LifecyclePhaseV1>(["started", "terminal"]),
  );
  const outcome =
    raw.outcome === undefined || raw.outcome === null
      ? undefined
      : requireEnum(raw.outcome, TERMINAL_OUTCOMES);
  if ((phase === "started" && outcome !== undefined) || (phase === "terminal" && outcome === undefined)) {
    fail("invalid_shape");
  }
  const finalizer = requireEnum(
    raw.finalizer,
    new Set<LifecycleFinalizerV1>(["producer", "collector"]),
  );
  if (finalizer === "collector" && outcome !== "abandoned") {
    fail("invalid_shape");
  }
  const model =
    raw.model === undefined || raw.model === null
      ? undefined
      : parseModelMetadata(raw.model);
  const plugin =
    raw.plugin === undefined || raw.plugin === null
      ? undefined
      : parsePluginMetadata(raw.plugin);
  if (
    model !== undefined &&
    operationName !== "anyharness.model.request" &&
    operationName !== "server.model_gateway.request"
  ) {
    fail("prohibited_metadata");
  }
  if (plugin !== undefined && operationName !== "anyharness.plugin.invoke") {
    fail("prohibited_metadata");
  }
  return canonicalClone({ phase, outcome, finalizer, model, plugin });
}

function parseModelMetadata(input: unknown) {
  const raw = requireObject(input);
  return canonicalClone({
    model_id: requireId(raw.model_id),
    provider_kind: optionalName(raw.provider_kind),
    phase:
      raw.phase === undefined || raw.phase === null
        ? undefined
        : requireEnum(raw.phase, METADATA_PHASES),
    input_tokens: optionalNonnegativeInteger(raw.input_tokens),
    output_tokens: optionalNonnegativeInteger(raw.output_tokens),
    duration_ms: optionalNonnegativeInteger(raw.duration_ms),
  });
}

function parsePluginMetadata(input: unknown) {
  const raw = requireObject(input);
  return canonicalClone({
    plugin_id: requireId(raw.plugin_id),
    kind: optionalName(raw.kind),
    phase:
      raw.phase === undefined || raw.phase === null
        ? undefined
        : requireEnum(raw.phase, METADATA_PHASES),
    duration_ms: optionalNonnegativeInteger(raw.duration_ms),
  });
}

export function parseFilters(input: unknown): RecordsFilterV1 {
  const raw = requireObject(input);
  const components = requireArray(raw.components);
  const recordClasses = requireArray(raw.record_classes);
  const severities = requireArray(raw.severities);
  const names = requireArray(raw.names);
  const outcomes = requireArray(raw.outcomes);
  if (
    [components, recordClasses, severities, names, outcomes].some(
      (values) => values.length > MAX_FILTER_VALUES,
    )
  ) {
    fail("limit_exceeded");
  }
  return canonicalClone({
    source_time_from:
      raw.source_time_from === undefined || raw.source_time_from === null
        ? undefined
        : requireTimestamp(raw.source_time_from),
    source_time_to:
      raw.source_time_to === undefined || raw.source_time_to === null
        ? undefined
        : requireTimestamp(raw.source_time_to),
    components: components.map((value) => requireEnum(value, COMPONENTS)),
    record_classes: recordClasses.map((value) => requireEnum(value, RECORD_CLASSES)),
    severities: severities.map((value) => requireEnum(value, SEVERITIES)),
    names: names.map(requireName),
    outcomes: outcomes.map((value) => requireEnum(value, TERMINAL_OUTCOMES)),
    operation_id: optionalId(raw.operation_id),
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
    error_classification: optionalName(raw.error_classification),
  });
}

export function parseGap(input: unknown) {
  const raw = requireObject(input);
  return canonicalClone({
    reason: requireEnum(
      raw.reason,
      new Set<GapReasonV1>([
        "evicted",
        "producer_sequence",
        "tail_lag",
        "collector_restart",
      ]),
    ),
    from_cursor: optionalNonnegativeInteger(raw.from_cursor),
    to_cursor: optionalNonnegativeInteger(raw.to_cursor),
    component:
      raw.component === undefined || raw.component === null
        ? undefined
        : requireEnum(raw.component, COMPONENTS),
    producer_boot_id: optionalId(raw.producer_boot_id),
    missing_sequence_from: optionalNonnegativeInteger(raw.missing_sequence_from),
    missing_sequence_to: optionalNonnegativeInteger(raw.missing_sequence_to),
    dropped_records: requireNonnegativeInteger(raw.dropped_records),
  });
}

export function parseVersionCount(input: unknown) {
  const raw = requireObject(input);
  return {
    version: parseSchemaVersion(raw.version),
    records: requireNonnegativeInteger(raw.records),
  };
}

export function validateCountMap<T extends string>(
  value: JsonObject,
  allowedKeys?: ReadonlySet<T>,
): void {
  for (const [key, count] of Object.entries(value)) {
    if (allowedKeys !== undefined && !allowedKeys.has(key as T)) {
      fail("invalid_shape");
    }
    requireNonnegativeInteger(count);
  }
}

export function rejectSecretFields(input: unknown): void {
  if (Array.isArray(input)) {
    input.forEach(rejectSecretFields);
    return;
  }
  if (!isObject(input)) {
    return;
  }
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_FIELD_NAMES.has(key)) {
      fail("prohibited_secret");
    }
    rejectSecretFields(value);
  }
}

export function rejectProhibitedModelPluginMetadata(record: JsonObject): void {
  if (!isObject(record.lifecycle)) {
    return;
  }
  for (const metadata of [record.lifecycle.model, record.lifecycle.plugin]) {
    if (
      isObject(metadata) &&
      Object.keys(metadata).some((key) => PROHIBITED_MODEL_PLUGIN_FIELDS.has(key))
    ) {
      fail("prohibited_metadata");
    }
  }
}
