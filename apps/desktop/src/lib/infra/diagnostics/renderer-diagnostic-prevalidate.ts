// First gate for renderer diagnostics: accept only well-formed input read
// through property descriptors, so getters cannot observe or mutate the record
// while it is being validated.

import type { SeverityV1 } from "@proliferate/product-client/internal/domain/diagnostics/contract";
import { MAX_ID_BYTES } from "@proliferate/product-client/internal/domain/diagnostics/limits";
import type {
  RendererDiagnosticCorrelation,
  RendererDiagnosticField,
  RendererDiagnosticInput,
  RendererDiagnosticKind,
  RendererDiagnosticPrivacy,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";
import {
  dataProperty,
  isBoundedNonempty,
  isEnumerableUndefined,
  isName,
  isPlainRecord,
  KINDS,
  optionalDataProperty,
  PRIVACY,
  SEVERITIES,
} from "./renderer-diagnostic-shape";

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
