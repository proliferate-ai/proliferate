/**
 * Pure template placeholder parsing + validation — format v2 (data-contract §1.3).
 *
 * Mirrors the server grammar (`server/.../workflows/domain/interpolation.py`):
 *
 *     {{inputs.<name>}}       -> a workflow input (eager at StartRun)
 *     {{<emit_name>.<field>}}  -> a field of an earlier `agent.emit` step
 *
 * Rules (identical to the server):
 *   - an input reference must name a declared input;
 *   - an emit reference must name an emit produced *strictly earlier* in run
 *     order (earlier nodes in full, earlier steps in the same node);
 *   - `inputs`, `steps`, `fields` are reserved first-segments (illegal emits).
 *
 * Pure and non-throwing for editor feedback: returns structured issues plus
 * match positions + autocomplete suggestions the panel editors consume.
 */

import { WORKFLOW_RESERVED_REF_SEGMENTS } from "./definition";

/** A placeholder that is `{{` (not backslash-escaped), a body, then `}}`. */
const PLACEHOLDER_RE = /(?<!\\)\{\{\s*([^{}]*?)\s*\}\}/g;
const INPUT_REF_RE = /^inputs\.([A-Za-z_][A-Za-z0-9_]*)$/;
const FIELDS_REF_RE = /^fields\.([A-Za-z_][A-Za-z0-9_]*)$/;
const EMIT_REF_RE = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/;

const RESERVED = new Set<string>(WORKFLOW_RESERVED_REF_SEGMENTS);

export type WorkflowReference =
  | { kind: "input"; name: string }
  | { kind: "emit"; emit: string; field: string }
  // Agent-filled notify field (track 3c). Legal only in a notify message that
  // declares agent_fields; the resolver rewrites it to an indexed ref.
  | { kind: "fields"; name: string };

export interface PlaceholderMatch {
  raw: string;
  body: string;
  reference: WorkflowReference | null;
  start: number;
  end: number;
}

export type TemplateReferenceCode =
  | "invalid_template_reference"
  | "unknown_input_reference"
  | "forward_emit_reference"
  | "fields_reference_not_allowed"
  | "unknown_field_reference";

export interface TemplateReferenceIssue {
  code: TemplateReferenceCode;
  message: string;
  match: PlaceholderMatch;
}

/** Parse a placeholder body into a typed reference, or null if malformed. */
export function parseReference(body: string): WorkflowReference | null {
  const inputMatch = INPUT_REF_RE.exec(body);
  if (inputMatch) {
    return { kind: "input", name: inputMatch[1]! };
  }
  // `fields.` before the generic emit rule (which would match `fields.name` then
  // fail the reserved-segment guard). Legality is enforced in validation.
  const fieldsMatch = FIELDS_REF_RE.exec(body);
  if (fieldsMatch) {
    return { kind: "fields", name: fieldsMatch[1]! };
  }
  const emitMatch = EMIT_REF_RE.exec(body);
  if (emitMatch && !RESERVED.has(emitMatch[1]!)) {
    return { kind: "emit", emit: emitMatch[1]!, field: emitMatch[2]! };
  }
  return null;
}

/** Every placeholder found in a string, in order, with positions. */
export function iterPlaceholders(value: string): PlaceholderMatch[] {
  const matches: PlaceholderMatch[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(value)) !== null) {
    const raw = match[0];
    const body = (match[1] ?? "").trim();
    matches.push({
      raw,
      body,
      reference: parseReference(body),
      start: match.index,
      end: match.index + raw.length,
    });
  }
  return matches;
}

/** Every well-formed reference in a string, in order. */
export function iterReferences(value: string): WorkflowReference[] {
  const refs: WorkflowReference[] = [];
  for (const placeholder of iterPlaceholders(value)) {
    if (placeholder.reference) {
      refs.push(placeholder.reference);
    }
  }
  return refs;
}

/**
 * Validate every placeholder in one templated string field. `priorEmitNames` is
 * the set of emit names produced strictly before this field's step in run order.
 * Returns issues rather than throwing (editor feedback).
 */
export function validateStringReferences(
  value: string,
  options: {
    inputNames: ReadonlySet<string>;
    priorEmitNames: ReadonlySet<string>;
    /**
     * The agent_fields schema field names, supplied ONLY for a notify `message`
     * that declares agent_fields (track 3c). `null`/undefined = `{{fields.*}}` is
     * illegal in this context.
     */
    allowedFields?: ReadonlySet<string> | null;
  },
): TemplateReferenceIssue[] {
  const issues: TemplateReferenceIssue[] = [];
  const allowedFields = options.allowedFields ?? null;
  for (const placeholder of iterPlaceholders(value)) {
    const { reference } = placeholder;
    if (reference === null) {
      issues.push({
        code: "invalid_template_reference",
        message:
          `'${placeholder.raw}' is not a valid template reference `
          + "(expected {{inputs.NAME}} or {{EMIT.FIELD}}).",
        match: placeholder,
      });
      continue;
    }
    if (reference.kind === "input") {
      if (!options.inputNames.has(reference.name)) {
        issues.push({
          code: "unknown_input_reference",
          message: `Template references unknown input '${reference.name}'.`,
          match: placeholder,
        });
      }
    } else if (reference.kind === "fields") {
      if (allowedFields === null) {
        issues.push({
          code: "fields_reference_not_allowed",
          message:
            `'${placeholder.raw}' is only allowed in a notify step's message `
            + "that declares agent_fields.",
          match: placeholder,
        });
      } else if (!allowedFields.has(reference.name)) {
        issues.push({
          code: "unknown_field_reference",
          message:
            `Template references agent field '${reference.name}', which is not `
            + "declared in the notify step's agent_fields schema.",
          match: placeholder,
        });
      }
    } else if (!options.priorEmitNames.has(reference.emit)) {
      issues.push({
        code: "forward_emit_reference",
        message:
          `Template references emit '${reference.emit}', which is not produced `
          + "by an earlier step in run order.",
        match: placeholder,
      });
    }
  }
  return issues;
}

// --- Editor autocomplete -------------------------------------------------------

export type TemplateSuggestionKind = "input" | "emit";

export interface TemplateSuggestion {
  /** The token to insert, e.g. `{{inputs.repo}}`. */
  token: string;
  label: string;
  detail: string;
  kind: TemplateSuggestionKind;
}

export interface EmitSuggestionSource {
  /** The emit name. */
  emit: string;
  /** Human label for the producing step. */
  stepLabel: string;
  /** Fields the emit publishes (from its output_schema). */
  fieldNames: readonly string[];
}

export interface TemplateSuggestionInput {
  inputs: readonly { name: string; type: string }[];
  /** Emits produced by steps that run strictly before this one. */
  priorEmits: readonly EmitSuggestionSource[];
}

/**
 * The set of valid `{{...}}` tokens available at a given step: every declared
 * input, plus every field of a strictly-earlier emit.
 */
export function templateSuggestions(input: TemplateSuggestionInput): TemplateSuggestion[] {
  const suggestions: TemplateSuggestion[] = [];
  for (const inp of input.inputs) {
    suggestions.push({
      token: `{{inputs.${inp.name}}}`,
      label: `inputs.${inp.name}`,
      detail: inp.type,
      kind: "input",
    });
  }
  for (const source of input.priorEmits) {
    for (const field of source.fieldNames) {
      suggestions.push({
        token: `{{${source.emit}.${field}}}`,
        label: `${source.emit}.${field}`,
        detail: `from ${source.stepLabel}`,
        kind: "emit",
      });
    }
  }
  return suggestions;
}
