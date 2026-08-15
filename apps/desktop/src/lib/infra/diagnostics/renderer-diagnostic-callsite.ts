import {
  diagnosticField,
  type RendererDiagnosticCorrelation,
  type RendererDiagnosticField,
  type RendererDiagnosticPrivacy,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";

const NAME_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;
const AMBIENT_FIELDS = new Set([
  "hostname",
  "install_id",
  "machine_id",
  "origin",
  "user_agent",
  "user_id",
  "username",
]);
const STRUCTURAL_ADAPTATION = Symbol("renderer-diagnostic-structural-adaptation");

export function rendererDiagnosticName(
  prefix: string,
  event: string,
): string | null {
  const name = `${prefix}.${event}`;
  return NAME_PATTERN.test(name) && new TextEncoder().encode(name).byteLength <= 128
    ? name
    : null;
}

export function rendererDiagnosticFields(
  metadata: Record<string, unknown> | undefined,
  privacy: RendererDiagnosticPrivacy,
): Record<string, RendererDiagnosticField> | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  const fields: Record<string, RendererDiagnosticField> = {};
  let structural = false;
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(metadata);
  } catch {
    const uninspectable = {
      metadata: diagnosticField("[uninspectable]", privacy),
    };
    markStructuralAdaptation(uninspectable);
    return uninspectable;
  }
  for (const [rawKey, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) {
      continue;
    }
    if (Object.keys(fields).length >= 32) {
      structural = true;
      continue;
    }
    const key = normalizeFieldName(rawKey);
    if (key === null || key in fields) {
      structural = true;
      continue;
    }
    if (AMBIENT_FIELDS.has(key)) {
      continue;
    }
    if (!("value" in descriptor)) {
      structural = true;
    }
    fields[key] = diagnosticField("value" in descriptor ? descriptor.value : "[accessor]", privacy);
  }
  if (structural) {
    markStructuralAdaptation(fields);
  }
  return Object.keys(fields).length === 0 && !structural ? undefined : fields;
}

export function rendererDiagnosticFieldsHadStructuralAdaptation(
  fields: unknown,
): boolean {
  if (typeof fields !== "object" || fields === null) {
    return false;
  }
  try {
    return Object.getOwnPropertyDescriptor(fields, STRUCTURAL_ADAPTATION)?.value === true;
  } catch {
    return true;
  }
}

function markStructuralAdaptation(fields: object): void {
  Object.defineProperty(fields, STRUCTURAL_ADAPTATION, {
    configurable: false,
    enumerable: false,
    value: true,
  });
}

export function rendererDiagnosticCorrelation(
  metadata: Record<string, unknown> | undefined,
): RendererDiagnosticCorrelation | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(metadata, "operationId");
  } catch {
    return undefined;
  }
  const value = descriptor?.enumerable === true && "value" in descriptor
    ? descriptor.value
    : undefined;
  return typeof value === "string" ? { operationId: value } : undefined;
}

function normalizeFieldName(value: string): string | null {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0
    && NAME_PATTERN.test(normalized)
    && new TextEncoder().encode(normalized).byteLength <= 128
    ? normalized
    : null;
}
