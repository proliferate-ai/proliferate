import type {
  ArgumentValueV1,
  DetailedKindV1,
  PrivacyClassificationV1,
  ProducerRecordV1,
  SeverityV1,
  TypedArgumentV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";
import {
  MAX_ARGUMENT_DEPTH,
  MAX_ARGUMENT_LIST_ITEMS,
  MAX_ARGUMENT_OBJECT_FIELDS,
  MAX_ARGUMENTS,
  MAX_ID_BYTES,
  MAX_MESSAGE_BYTES,
  MAX_NAME_BYTES,
  MAX_RECORD_BYTES,
  MAX_SAFE_INTEGER,
  MAX_STRING_BYTES,
} from "@proliferate/product-client/internal/domain/diagnostics/limits";
import { parseProducerRecordV1 } from "@proliferate/product-client/internal/domain/diagnostics/validation";
import type {
  RendererDiagnosticCorrelation,
  RendererDiagnosticField,
  RendererDiagnosticInput,
  RendererDiagnosticKind,
  RendererDiagnosticPrivacy,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";
import { rendererDiagnosticFieldsHadStructuralAdaptation } from "./renderer-diagnostic-callsite";
import { isRendererDiagnosticSecretKey as isSecretKey } from "./renderer-diagnostic-secret-keys";
import { filterRendererDiagnosticText } from "./renderer-diagnostic-text";

const textEncoder = new TextEncoder();
const NAME_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;
const SEVERITIES = new Set<SeverityV1>([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
]);
const KINDS = new Set<RendererDiagnosticKind>([
  "log",
  "message",
  "milestone",
  "progress",
  "transport",
]);
const PRIVACY = new Set<RendererDiagnosticPrivacy>([
  "operational",
  "customer_content",
  "sensitive",
]);
const PRIVACY_RANK: Record<RendererDiagnosticPrivacy, number> = {
  operational: 0,
  customer_content: 1,
  sensitive: 2,
};
const CORRELATION_KEYS = [
  "operationId",
  "parentOperationId",
  "traceId",
  "workspaceId",
  "sessionId",
  "turnId",
  "itemId",
  "requestId",
  "targetId",
  "promptId",
  "workflowId",
] as const satisfies readonly (keyof RendererDiagnosticCorrelation)[];
export interface PrevalidatedRendererDiagnostic {
  name: string;
  severity: SeverityV1;
  kind: RendererDiagnosticKind | "loss_summary";
  message?: string;
  privacy: RendererDiagnosticPrivacy;
  fields?: Readonly<Record<string, RendererDiagnosticField>>;
  correlation: RendererDiagnosticCorrelation;
  errorClassification?: string;
  droppedCount?: number;
  structural: boolean;
}

export interface RendererRecordEnvelope {
  producerBootId: string;
  producerSequence: number;
  release: string;
  environment: string;
  operationId: string;
  sourceTimestamp: string;
  pathname?: string;
}

export interface RendererRecordBuildResult {
  record: ProducerRecordV1;
  serializedBytes: number;
}

interface NormalizationState {
  structural: boolean;
  ancestors: Set<object>;
  remainingNodes: number;
  remainingValueBytes: number;
}

export function prevalidateRendererDiagnostic(
  input: RendererDiagnosticInput,
): PrevalidatedRendererDiagnostic | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const name = dataProperty(descriptors.name);
  const severity = dataProperty(descriptors.severity);
  const privacy = dataProperty(descriptors.privacy);
  let structural = false;
  const kind = descriptors.kind === undefined || isEnumerableUndefined(descriptors.kind)
    ? "log"
    : dataProperty(descriptors.kind);
  const errorClassification = optionalDataProperty(
    descriptors.errorClassification,
    () => { structural = true; },
  );
  const message = optionalDataProperty(
    descriptors.message,
    () => { structural = true; },
    "[accessor]",
  );
  const fields = optionalDataProperty(
    descriptors.fields,
    () => { structural = true; },
  );
  const correlation = descriptors.correlation === undefined
      || isEnumerableUndefined(descriptors.correlation)
    ? {}
    : dataProperty(descriptors.correlation);

  if (
    !isName(name)
    || !SEVERITIES.has(severity as SeverityV1)
    || !PRIVACY.has(privacy as RendererDiagnosticPrivacy)
    || !KINDS.has(kind as RendererDiagnosticKind)
    || (message !== undefined && typeof message !== "string")
    || (errorClassification !== undefined && !isName(errorClassification))
    || (fields !== undefined && !isPlainRecord(fields))
    || !isPlainRecord(correlation)
  ) {
    return null;
  }

  const correlationDescriptors = Object.getOwnPropertyDescriptors(correlation);
  const acceptedCorrelation: RendererDiagnosticCorrelation = {};
  for (const key of CORRELATION_KEYS) {
    const descriptor = correlationDescriptors[key];
    if (descriptor === undefined) {
      continue;
    }
    const value = dataProperty(descriptor);
    if (typeof value !== "string" || !isBoundedNonempty(value, MAX_ID_BYTES)) {
      return null;
    }
    acceptedCorrelation[key] = value;
  }

  return {
    name,
    severity: severity as SeverityV1,
    kind: kind as RendererDiagnosticKind,
    message,
    privacy: privacy as RendererDiagnosticPrivacy,
    fields: fields as Readonly<Record<string, RendererDiagnosticField>> | undefined,
    correlation: acceptedCorrelation,
    errorClassification,
    structural,
  };
}

export function buildRendererProducerRecord(
  input: PrevalidatedRendererDiagnostic,
  envelope: RendererRecordEnvelope,
): RendererRecordBuildResult | null {
  const state: NormalizationState = {
    structural: input.structural
      || rendererDiagnosticFieldsHadStructuralAdaptation(input.fields),
    ancestors: new Set(),
    remainingNodes: Math.floor(MAX_RECORD_BYTES / 16),
    remainingValueBytes: MAX_RECORD_BYTES,
  };
  const args: TypedArgumentV1[] = [];
  let privacy = input.privacy;

  if (input.fields !== undefined) {
    const descriptors = Object.getOwnPropertyDescriptors(input.fields);
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (args.length >= MAX_ARGUMENTS) {
        state.structural = true;
        break;
      }
      if (isSecretKey(name)) {
        state.structural = true;
        continue;
      }
      if (!descriptor.enumerable || !isName(name) || !("value" in descriptor)) {
        state.structural = true;
        continue;
      }
      const field = descriptor.value;
      if (!isPlainRecord(field)) {
        state.structural = true;
        continue;
      }
      const fieldDescriptors = Object.getOwnPropertyDescriptors(field);
      const fieldPrivacy = dataProperty(fieldDescriptors.privacy);
      if (fieldPrivacy === "secret") {
        state.structural = true;
        continue;
      }
      if (!PRIVACY.has(fieldPrivacy as RendererDiagnosticPrivacy)) {
        state.structural = true;
        continue;
      }
      const valueDescriptor = fieldDescriptors.value;
      const normalized = valueDescriptor?.enumerable !== true || !("value" in valueDescriptor)
        ? (() => {
            state.structural = true;
            return marker("[accessor]", state);
          })()
        : normalizeValue(valueDescriptor.value, 1, state);
      args.push({
        name,
        privacy: fieldPrivacy as RendererDiagnosticPrivacy,
        value: normalized,
      });
      privacy = highestPrivacy(privacy, fieldPrivacy as RendererDiagnosticPrivacy);
    }
  }

  if (envelope.pathname !== undefined && args.length < MAX_ARGUMENTS) {
    const pathname = filterText(envelope.pathname, MAX_STRING_BYTES, state);
    args.push({
      name: "pathname",
      privacy: "sensitive",
      value: { type: "string", value: pathname },
    });
    privacy = "sensitive";
  } else if (envelope.pathname !== undefined) {
    state.structural = true;
  }

  const base: ProducerRecordV1 = {
    schema_version: { major: 1, minor: 1 },
    source_timestamp: envelope.sourceTimestamp,
    producer_sequence: envelope.producerSequence,
    producer_boot_id: envelope.producerBootId,
    component: "desktop_renderer",
    source: "renderer",
    release: boundedEnvelopeValue(envelope.release),
    environment: boundedEnvelopeValue(envelope.environment),
    operation_id: input.correlation.operationId ?? envelope.operationId,
    parent_operation_id: input.correlation.parentOperationId,
    trace_id: input.correlation.traceId,
    workspace_id: input.correlation.workspaceId,
    session_id: input.correlation.sessionId,
    turn_id: input.correlation.turnId,
    item_id: input.correlation.itemId,
    request_id: input.correlation.requestId,
    target_id: input.correlation.targetId,
    prompt_id: input.correlation.promptId,
    workflow_id: input.correlation.workflowId,
    name: input.name,
    severity: input.severity,
    arguments: args,
    error_classification: input.errorClassification,
    record_class: "detailed",
    privacy,
    redaction: state.structural ? "structural" : "none",
    detailed: {
      kind: input.kind as DetailedKindV1,
      message: input.message === undefined
        ? undefined
        : filterText(input.message, MAX_MESSAGE_BYTES, state),
      dropped_count: input.droppedCount,
    },
  };

  // Message filtering may have changed the redaction state after the envelope
  // was assembled.
  base.redaction = state.structural ? "structural" : "none";
  return validateAndBoundRecord(base, state, input.privacy);
}

function validateAndBoundRecord(
  candidate: ProducerRecordV1,
  state: NormalizationState,
  inputPrivacy: RendererDiagnosticPrivacy,
): RendererRecordBuildResult | null {
  while (true) {
    candidate.redaction = state.structural ? "structural" : "none";
    try {
      const record = parseProducerRecordV1(candidate);
      return {
        record,
        serializedBytes: textEncoder.encode(JSON.stringify(record)).byteLength,
      };
    } catch {
      if (candidate.arguments.length === 0) {
        return null;
      }
      candidate.arguments.pop();
      state.structural = true;
      candidate.privacy = candidate.arguments.reduce<PrivacyClassificationV1>(
        (highest, argument) => highestPrivacy(
          highest as RendererDiagnosticPrivacy,
          argument.privacy as RendererDiagnosticPrivacy,
        ),
        inputPrivacy,
      );
    }
  }
}

function normalizeValue(
  value: unknown,
  depth: number,
  state: NormalizationState,
): ArgumentValueV1 {
  if (!reserveNormalizationNode(state)) {
    return marker("[truncated]", state);
  }
  if (typeof value === "string") {
    return {
      type: "string",
      value: consumeNormalizationText(
        filterText(value, MAX_STRING_BYTES, state),
        state,
      ),
    };
  }
  if (typeof value === "boolean") {
    return { type: "boolean", value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return marker(`[number:${String(value)}]`, state);
    }
    if (Number.isInteger(value) && Math.abs(value) <= MAX_SAFE_INTEGER) {
      return { type: "integer", value };
    }
    return { type: "float", value };
  }
  if (value === null) {
    return marker("[null]", state);
  }
  if (typeof value !== "object") {
    return marker(`[${typeof value}]`, state);
  }
  if (depth >= MAX_ARGUMENT_DEPTH) {
    return marker("[truncated]", state);
  }
  if (state.ancestors.has(value)) {
    return marker("[circular]", state);
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    return marker("[object]", state);
  }
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const output: ArgumentValueV1[] = [];
      const limit = Math.min(value.length, MAX_ARGUMENT_LIST_ITEMS);
      for (let index = 0; index < limit; index += 1) {
        if (!normalizationBudgetAvailable(state)) {
          output.push(marker("[truncated]", state));
          break;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        output.push(
          descriptor?.enumerable === true && "value" in descriptor
            ? normalizeValue(descriptor.value, depth + 1, state)
            : marker("[accessor]", state),
        );
      }
      if (value.length > MAX_ARGUMENT_LIST_ITEMS) {
        state.structural = true;
        output[MAX_ARGUMENT_LIST_ITEMS - 1] = marker("[truncated]", state);
      }
      return { type: "list", value: output };
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return marker("[object]", state);
    }

    const output: Record<string, ArgumentValueV1> = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    let admitted = 0;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) {
        continue;
      }
      if (admitted >= MAX_ARGUMENT_OBJECT_FIELDS) {
        state.structural = true;
        break;
      }
      if (isSecretKey(key)) {
        state.structural = true;
        continue;
      }
      if (!isName(key)) {
        state.structural = true;
        continue;
      }
      if (!consumeNormalizationKey(key, state)) {
        state.structural = true;
        break;
      }
      output[key] = "value" in descriptor
        ? normalizeValue(descriptor.value, depth + 1, state)
        : marker("[accessor]", state);
      admitted += 1;
    }
    return { type: "object", value: output };
  } finally {
    state.ancestors.delete(value);
  }
}

function marker(value: string, state: NormalizationState): ArgumentValueV1 {
  state.structural = true;
  return { type: "string", value };
}

function filterText(
  input: string,
  limit: number,
  state: NormalizationState,
): string {
  const filtered = filterRendererDiagnosticText(input, limit);
  state.structural ||= filtered.structural;
  return filtered.value;
}

function normalizationBudgetAvailable(state: NormalizationState): boolean {
  return state.remainingNodes > 0 && state.remainingValueBytes > 0;
}

function reserveNormalizationNode(state: NormalizationState): boolean {
  if (!normalizationBudgetAvailable(state)) {
    state.structural = true;
    return false;
  }
  state.remainingNodes -= 1;
  state.remainingValueBytes = Math.max(0, state.remainingValueBytes - 16);
  return true;
}

function consumeNormalizationKey(key: string, state: NormalizationState): boolean {
  const bytes = textEncoder.encode(key).byteLength;
  if (bytes > state.remainingValueBytes) {
    return false;
  }
  state.remainingValueBytes -= bytes;
  return true;
}

function consumeNormalizationText(value: string, state: NormalizationState): string {
  const bytes = textEncoder.encode(value).byteLength;
  if (bytes <= state.remainingValueBytes) {
    state.remainingValueBytes -= bytes;
    return value;
  }
  state.remainingValueBytes = 0;
  state.structural = true;
  return "[truncated]";
}

function isName(value: unknown): value is string {
  return typeof value === "string"
    && isBoundedNonempty(value, MAX_NAME_BYTES)
    && NAME_PATTERN.test(value);
}

function isBoundedNonempty(value: string, maxBytes: number): boolean {
  return value.length > 0 && textEncoder.encode(value).byteLength <= maxBytes;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataProperty(descriptor: PropertyDescriptor | undefined): unknown {
  return descriptor?.enumerable === true && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function optionalDataProperty(
  descriptor: PropertyDescriptor | undefined,
  markStructural: () => void,
  accessorMarker?: unknown,
): unknown {
  if (descriptor === undefined || descriptor.enumerable !== true) {
    return undefined;
  }
  if ("value" in descriptor) {
    return descriptor.value;
  }
  markStructural();
  return accessorMarker;
}

function isEnumerableUndefined(descriptor: PropertyDescriptor): boolean {
  return descriptor.enumerable === true
    && "value" in descriptor
    && descriptor.value === undefined;
}

function highestPrivacy(
  left: RendererDiagnosticPrivacy,
  right: RendererDiagnosticPrivacy,
): RendererDiagnosticPrivacy {
  return PRIVACY_RANK[left] >= PRIVACY_RANK[right] ? left : right;
}

function boundedEnvelopeValue(value: string): string {
  if (isBoundedNonempty(value, MAX_NAME_BYTES)) {
    return value;
  }
  return "unknown";
}
