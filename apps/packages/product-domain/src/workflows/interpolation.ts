/**
 * Pure template placeholder parsing + validation for workflow definitions.
 *
 * Mirrors the server grammar (`server/.../workflows/domain/interpolation.py`)
 * exactly so the editor surfaces the same errors the control plane would reject
 * on save:
 *
 *     {{args.<name>}}               -> a workflow argument
 *     {{steps[<n>].output.<name>}}  -> the public output of an earlier step
 *
 * Rules (identical to the server):
 *   - an arg reference must name a declared argument;
 *   - a step-output reference must point at a step that runs strictly earlier
 *     (`index < stepIndex`).
 *
 * This module is presentation-adjacent but pure: it never throws for editor
 * feedback (it returns structured issues), and additionally exposes match
 * positions + autocomplete suggestions the panel editors consume.
 */

/** A placeholder that is `{{` (not backslash-escaped), a body, then `}}`. */
const PLACEHOLDER_RE = /(?<!\\)\{\{\s*([^{}]*?)\s*\}\}/g;
const ARG_REF_RE = /^args\.([A-Za-z_][A-Za-z0-9_]*)$/;
const STEP_REF_RE = /^steps\[(\d+)\]\.output\.([A-Za-z_][A-Za-z0-9_]*)$/;

export type WorkflowReference =
  | { kind: "arg"; name: string }
  | { kind: "stepOutput"; index: number; name: string };

export interface PlaceholderMatch {
  /** The full matched text, e.g. `{{args.repo}}`. */
  raw: string;
  /** The trimmed reference body, e.g. `args.repo`. */
  body: string;
  /** Parsed reference, or null when the body is not a valid reference. */
  reference: WorkflowReference | null;
  /** Start offset of the match within the source string. */
  start: number;
  /** End offset (exclusive) of the match within the source string. */
  end: number;
}

export type TemplateReferenceCode =
  | "invalid_template_reference"
  | "unknown_arg_reference"
  | "forward_step_reference";

export interface TemplateReferenceIssue {
  code: TemplateReferenceCode;
  message: string;
  /** Which placeholder in the string this issue is about. */
  match: PlaceholderMatch;
}

/** Parse a placeholder body into a typed reference, or null if malformed. */
export function parseReference(body: string): WorkflowReference | null {
  const argMatch = ARG_REF_RE.exec(body);
  if (argMatch) {
    return { kind: "arg", name: argMatch[1]! };
  }
  const stepMatch = STEP_REF_RE.exec(body);
  if (stepMatch) {
    return { kind: "stepOutput", index: Number(stepMatch[1]), name: stepMatch[2]! };
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
 * Validate every placeholder in one templated string field. `stepIndex` is the
 * index of the step the field belongs to; a step-output reference must point
 * strictly earlier. Returns issues rather than throwing (editor feedback).
 */
export function validateStringReferences(
  value: string,
  options: { argNames: ReadonlySet<string>; stepIndex: number },
): TemplateReferenceIssue[] {
  const issues: TemplateReferenceIssue[] = [];
  for (const placeholder of iterPlaceholders(value)) {
    const { reference } = placeholder;
    if (reference === null) {
      issues.push({
        code: "invalid_template_reference",
        message:
          `'${placeholder.raw}' is not a valid template reference `
          + "(expected {{args.NAME}} or {{steps[N].output.NAME}}).",
        match: placeholder,
      });
      continue;
    }
    if (reference.kind === "arg") {
      if (!options.argNames.has(reference.name)) {
        issues.push({
          code: "unknown_arg_reference",
          message: `Template references unknown argument '${reference.name}'.`,
          match: placeholder,
        });
      }
    } else if (reference.index >= options.stepIndex) {
      issues.push({
        code: "forward_step_reference",
        message:
          `Step ${options.stepIndex} references output of step `
          + `${reference.index}, which does not run before it.`,
        match: placeholder,
      });
    }
  }
  return issues;
}

// --- Editor autocomplete -------------------------------------------------------

export type TemplateSuggestionKind = "arg" | "stepOutput";

export interface TemplateSuggestion {
  /** The token to insert, e.g. `{{args.repo}}`. */
  token: string;
  /** Short label shown in the menu, e.g. `args.repo`. */
  label: string;
  /** Longer hint, e.g. the arg type or the producing step. */
  detail: string;
  kind: TemplateSuggestionKind;
}

export interface StepOutputSuggestionSource {
  /** Index of the earlier step. */
  index: number;
  /** Human label for the producing step (e.g. `Script`). */
  stepLabel: string;
  /** Named outputs the step publishes (e.g. `["diff", "exit_code"]`). */
  outputNames: readonly string[];
}

export interface TemplateSuggestionInput {
  /** Declared workflow arguments (name + display type). */
  args: readonly { name: string; type: string }[];
  /** The index of the step currently being edited. */
  stepIndex: number;
  /** Outputs published by steps that run before this one. */
  priorStepOutputs: readonly StepOutputSuggestionSource[];
}

/**
 * The set of valid `{{...}}` tokens available at a given step: every declared
 * argument, plus every named output of a strictly-earlier step.
 */
export function templateSuggestions(input: TemplateSuggestionInput): TemplateSuggestion[] {
  const suggestions: TemplateSuggestion[] = [];
  for (const arg of input.args) {
    suggestions.push({
      token: `{{args.${arg.name}}}`,
      label: `args.${arg.name}`,
      detail: arg.type,
      kind: "arg",
    });
  }
  for (const source of input.priorStepOutputs) {
    if (source.index >= input.stepIndex) {
      continue;
    }
    for (const name of source.outputNames) {
      suggestions.push({
        token: `{{steps[${source.index}].output.${name}}}`,
        label: `steps[${source.index}].output.${name}`,
        detail: `from step ${source.index + 1} · ${source.stepLabel}`,
        kind: "stepOutput",
      });
    }
  }
  return suggestions;
}
