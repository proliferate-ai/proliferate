/**
 * Read-only handling for unsupported workflow definitions (feature spec §5.1).
 *
 * An older client must never drop unknown data or save a truncated definition.
 * `parseWorkflowDefinitionResult` returns a typed union: an `editable` model for
 * supported definitions, or an `unsupported` marker (carrying the raw dict and
 * its version) for an unknown definition version or an unknown step kind. The
 * editor renders the read-only/upgrade state from the marker; the serializer
 * only ever accepts the `editable` model, so saving an unsupported definition is
 * a type-level impossibility.
 */

import { WORKFLOW_STEP_KINDS, type WorkflowDefinition } from "./definition";
import { parseCanonicalDefinition, type ParseIdentityOptions } from "./identity";

export const SUPPORTED_DEFINITION_VERSION = 1;

export type ParsedWorkflowDefinition =
  | { kind: "editable"; definition: WorkflowDefinition }
  | { kind: "unsupported"; reason: "version" | "step_kind"; version: unknown; raw: unknown };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const KNOWN_STEP_KINDS = new Set<string>(WORKFLOW_STEP_KINDS);

/** True when any step in the raw dict carries a kind this client does not know. */
function hasUnknownStepKind(record: Record<string, unknown>): boolean {
  const agents = Array.isArray(record.agents) ? record.agents : [];
  const nodeHasUnknown = (node: unknown): boolean => {
    const steps = asRecord(node)?.steps;
    if (!Array.isArray(steps)) {
      return false;
    }
    return steps.some((step) => {
      const kind = asRecord(step)?.kind;
      return typeof kind === "string" && !KNOWN_STEP_KINDS.has(kind);
    });
  };
  return agents.some((entry) => {
    const rec = asRecord(entry);
    if (rec && Array.isArray(rec.parallel)) {
      return rec.parallel.some(nodeHasUnknown);
    }
    return nodeHasUnknown(entry);
  });
}

/**
 * Parse a stored definition into a typed editable/unsupported result. Unknown
 * versions and unknown step kinds are surfaced as `unsupported` (never silently
 * coerced or dropped).
 */
export function parseWorkflowDefinitionResult(
  raw: unknown,
  options: ParseIdentityOptions = {},
): ParsedWorkflowDefinition {
  const record = asRecord(raw);
  const version = record?.version;
  if (version !== SUPPORTED_DEFINITION_VERSION) {
    return { kind: "unsupported", reason: "version", version, raw };
  }
  if (record && hasUnknownStepKind(record)) {
    return { kind: "unsupported", reason: "step_kind", version, raw };
  }
  return { kind: "editable", definition: parseCanonicalDefinition(raw, options) };
}
