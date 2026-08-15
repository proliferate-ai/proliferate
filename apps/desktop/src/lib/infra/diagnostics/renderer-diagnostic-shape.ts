// Closed vocabularies and property-descriptor guards shared by the renderer
// diagnostic prevalidation, normalization, and record-building steps.

import type { SeverityV1 } from "@proliferate/product-client/internal/domain/diagnostics/contract";
import { MAX_NAME_BYTES } from "@proliferate/product-client/internal/domain/diagnostics/limits";
import type {
  RendererDiagnosticKind,
  RendererDiagnosticPrivacy,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";

export const textEncoder = new TextEncoder();

const NAME_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;

export const SEVERITIES = new Set<SeverityV1>([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
]);
export const KINDS = new Set<RendererDiagnosticKind>([
  "log",
  "message",
  "milestone",
  "progress",
  "transport",
]);
export const PRIVACY = new Set<RendererDiagnosticPrivacy>([
  "operational",
  "customer_content",
  "sensitive",
]);

const PRIVACY_RANK: Record<RendererDiagnosticPrivacy, number> = {
  operational: 0,
  customer_content: 1,
  sensitive: 2,
};

export function isName(value: unknown): value is string {
  return typeof value === "string"
    && isBoundedNonempty(value, MAX_NAME_BYTES)
    && NAME_PATTERN.test(value);
}

export function isBoundedNonempty(value: string, maxBytes: number): boolean {
  return value.length > 0 && textEncoder.encode(value).byteLength <= maxBytes;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function dataProperty(descriptor: PropertyDescriptor | undefined): unknown {
  return descriptor?.enumerable === true && "value" in descriptor
    ? descriptor.value
    : undefined;
}

export function optionalDataProperty(
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

export function isEnumerableUndefined(descriptor: PropertyDescriptor): boolean {
  return descriptor.enumerable === true
    && "value" in descriptor
    && descriptor.value === undefined;
}

export function highestPrivacy(
  left: RendererDiagnosticPrivacy,
  right: RendererDiagnosticPrivacy,
): RendererDiagnosticPrivacy {
  return PRIVACY_RANK[left] >= PRIVACY_RANK[right] ? left : right;
}

export function boundedEnvelopeValue(value: string): string {
  if (isBoundedNonempty(value, MAX_NAME_BYTES)) {
    return value;
  }
  return "unknown";
}
