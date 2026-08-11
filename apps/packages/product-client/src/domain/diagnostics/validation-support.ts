import { isP0Operation } from "./catalog";
import type {
  ArgumentValueV1,
  ComponentV1,
  DetailedKindV1,
  GapReasonV1,
  LifecycleFinalizerV1,
  LifecyclePhaseV1,
  MetadataPhaseV1,
  PrivacyClassificationV1,
  ProducerRecordV1,
  RecordClassV1,
  RedactionClassificationV1,
  RecordsFilterV1,
  RejectionReasonV1,
  SchemaVersionV1,
  SeverityV1,
  SourceV1,
  StandardStreamV1,
  TerminalOutcomeV1,
  TypedArgumentV1,
} from "./contract";
import {
  CURRENT_SCHEMA_VERSION,
  MAX_ARGUMENT_DEPTH,
  MAX_ARGUMENT_LIST_ITEMS,
  MAX_ARGUMENT_OBJECT_FIELDS,
  MAX_FILTER_VALUES,
  MAX_ID_BYTES,
  MAX_MESSAGE_BYTES,
  MAX_NAME_BYTES,
  MAX_SAFE_INTEGER,
  MAX_STRING_BYTES,
  MIN_SUPPORTED_PRODUCER_MINOR,
} from "./limits";

export type JsonObject = Record<string, unknown>;

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
const DETAILED_KINDS = new Set<DetailedKindV1>([
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
const TERMINAL_OUTCOMES = new Set<TerminalOutcomeV1>([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "abandoned",
  "rejected",
  "skipped",
]);
const METADATA_PHASES = new Set<MetadataPhaseV1>([
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
const SECRET_FIELD_NAMES = new Set([
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
const PROHIBITED_MODEL_PLUGIN_FIELDS = new Set([
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

export class DiagnosticsContractErrorV1 extends Error {
  readonly reason: RejectionReasonV1;

  constructor(reason: RejectionReasonV1) {
    super(reason);
    this.name = "DiagnosticsContractErrorV1";
    this.reason = reason;
  }
}

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

export function requireObject(input: unknown): JsonObject {
  if (!isObject(input)) {
    fail("invalid_shape");
  }
  return input;
}

function isObject(input: unknown): input is JsonObject {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function requireArray(input: unknown): unknown[] {
  if (!Array.isArray(input)) {
    fail("invalid_shape");
  }
  return input;
}

export function requireString(input: unknown): string {
  if (typeof input !== "string") {
    fail("invalid_shape");
  }
  return input;
}

export function requireBoundedString(input: unknown, limit: number): string {
  const value = requireString(input);
  if (value.length === 0) {
    fail("invalid_shape");
  }
  if (utf8ByteLength(value) > limit) {
    fail("limit_exceeded");
  }
  return value;
}

export function requireName(input: unknown): string {
  const value = requireBoundedString(input, MAX_NAME_BYTES);
  if (!/^[a-z0-9][a-z0-9._:-]*$/.test(value)) {
    fail("invalid_shape");
  }
  return value;
}

export function optionalName(input: unknown): string | undefined {
  return input === undefined || input === null ? undefined : requireName(input);
}

export function requireId(input: unknown): string {
  return requireBoundedString(input, MAX_ID_BYTES);
}

export function optionalId(input: unknown): string | undefined {
  return input === undefined || input === null ? undefined : requireId(input);
}

export function requireShortString(input: unknown): string {
  return requireBoundedString(input, MAX_NAME_BYTES);
}

export function requireTimestamp(input: unknown): string {
  const value = requireString(input);
  if (
    value.length < 20 ||
    value.length > 35 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    fail("invalid_shape");
  }
  return value;
}

export function requireBoolean(input: unknown): boolean {
  if (typeof input !== "boolean") {
    fail("invalid_shape");
  }
  return input;
}

export function requireFiniteNumber(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    fail("invalid_shape");
  }
  return input;
}

export function requireInteger(input: unknown): number {
  const value = requireFiniteNumber(input);
  if (!Number.isInteger(value)) {
    fail("invalid_shape");
  }
  if (Math.abs(value) > MAX_SAFE_INTEGER) {
    fail("limit_exceeded");
  }
  return value;
}

export function requireNonnegativeInteger(input: unknown): number {
  const value = requireInteger(input);
  if (value < 0) {
    fail("invalid_shape");
  }
  return value;
}

export function requirePositiveInteger(input: unknown): number {
  const value = requireNonnegativeInteger(input);
  if (value === 0) {
    fail("invalid_shape");
  }
  return value;
}

export function optionalNonnegativeInteger(input: unknown): number | undefined {
  return input === undefined || input === null
    ? undefined
    : requireNonnegativeInteger(input);
}

export function requireEnum<T extends string>(input: unknown, values: Set<T>): T {
  const value = requireString(input);
  if (!values.has(value as T)) {
    fail("invalid_shape");
  }
  return value as T;
}

export function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        fail("invalid_shape");
      }
      bytes += 4;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail("invalid_shape");
    }
    bytes += codeUnit <= 0x7f ? 1 : codeUnit <= 0x7ff ? 2 : 3;
  }
  return bytes;
}

export function canonicalClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function fail(reason: RejectionReasonV1): never {
  throw new DiagnosticsContractErrorV1(reason);
}
