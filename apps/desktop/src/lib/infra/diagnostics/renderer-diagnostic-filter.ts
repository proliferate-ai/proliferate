// Builds contract-valid producer records from prevalidated renderer
// diagnostics. This module is the entry point for the renderer filter; the
// vocabulary, prevalidation, and value normalization steps live in the sibling
// `renderer-diagnostic-shape` / `-prevalidate` / `-normalize` modules.

import type {
  PrivacyClassificationV1,
  DetailedKindV1,
  ProducerRecordV1,
  TypedArgumentV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";
import {
  MAX_ARGUMENTS,
  MAX_MESSAGE_BYTES,
  MAX_RECORD_BYTES,
  MAX_STRING_BYTES,
} from "@proliferate/product-client/internal/domain/diagnostics/limits";
import { parseProducerRecordV1 } from "@proliferate/product-client/internal/domain/diagnostics/validation";
import type { RendererDiagnosticPrivacy } from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";
import { rendererDiagnosticFieldsHadStructuralAdaptation } from "./renderer-diagnostic-callsite";
import type { NormalizationState } from "./renderer-diagnostic-normalize";
import { filterText, marker, normalizeValue } from "./renderer-diagnostic-normalize";
import type { PrevalidatedRendererDiagnostic } from "./renderer-diagnostic-prevalidate";
import { isRendererDiagnosticSecretKey as isSecretKey } from "./renderer-diagnostic-secret-keys";
import {
  boundedEnvelopeValue,
  dataProperty,
  highestPrivacy,
  isName,
  isPlainRecord,
  PRIVACY,
  textEncoder,
} from "./renderer-diagnostic-shape";

export type { PrevalidatedRendererDiagnostic } from "./renderer-diagnostic-prevalidate";
export { prevalidateRendererDiagnostic } from "./renderer-diagnostic-prevalidate";

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
