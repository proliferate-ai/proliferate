import type { WorkflowDefinitionV2 } from "@proliferate/cloud-sdk";
import {
  DOC_SLUG_PATTERN,
  INPUT_NAME_PATTERN,
  validateDefinitionV2,
  type DefinitionV2Issue,
  type DefinitionV2IssueCode,
} from "#product/domain/workflows/definition-v2";

/**
 * The builder's save gate, assembled from the shared grammar rather than from
 * rules of its own.
 *
 * `validateDefinitionV2` deliberately does not grammar-check DECLARED input
 * names and doc slugs — the control plane's wire models own that half, and the
 * validator sees whatever the builder holds. So a declaration the author typed
 * (`my input`, `My_Doc`) would pass every local check and be refused by the
 * server. This module closes that gap by applying the SAME exported patterns
 * the reference scanner applies to `@input:`/`@doc:` tokens, so a value the
 * builder accepts is a value the wire accepts. The patterns are imported, never
 * restated: one grammar, checked wherever it applies.
 */

export type WorkflowBuilderIssueCode =
  | DefinitionV2IssueCode
  /** A declared input name outside `INPUT_NAME_PATTERN`. */
  | "invalid_input_name"
  /** A declared doc slug outside `DOC_SLUG_PATTERN`. */
  | "invalid_doc_slug"
  /** A step with no title; the runtime refuses one outright. */
  | "empty_node_title"
  /** A step with no prompt; the wire model refuses an empty one. */
  | "empty_node_prompt"
  | "input_not_connected";

/**
 * Same shape as `DefinitionV2Issue` over a wider code union, so the validator's
 * own issues flow into the builder's lists unchanged.
 */
export interface WorkflowBuilderIssue extends Omit<DefinitionV2Issue, "code"> {
  code: WorkflowBuilderIssueCode;
}

/** Every rule the builder gates a save on. Empty array = savable definition. */
export function workflowBuilderIssues(
  definition: WorkflowDefinitionV2,
  inputConnectedTo?: string | null,
): WorkflowBuilderIssue[] {
  const issues: WorkflowBuilderIssue[] = [
    ...validateDefinitionV2(definition),
    ...nodeFieldIssues(definition),
    ...declarationGrammarIssues(definition),
  ];
  if (inputConnectedTo !== undefined) {
    const incoming = new Set(definition.edges.map((edge) => edge.to));
    const heads = definition.nodes.filter((node) => !incoming.has(node.id));
    const head = heads.length === 1 ? heads[0].id : null;
    if (head === null || inputConnectedTo !== head) {
      issues.push({
        code: "input_not_connected",
        message: "Connect Input to the first node in the workflow path.",
        ref: inputConnectedTo ?? undefined,
      });
    }
  }
  return issues;
}

/**
 * The per-step fields every plane requires and the shared validator does not
 * look at: the control plane's wire model refuses an empty `title`/`prompt`
 * with `min_length`, and the runtime refuses an untitled node outright. A step
 * is minted blank, so without these a just-added step would pass every local
 * check and be refused by the server the moment Save is pressed.
 */
function nodeFieldIssues(definition: WorkflowDefinitionV2): WorkflowBuilderIssue[] {
  const issues: WorkflowBuilderIssue[] = [];
  definition.nodes.forEach((node, index) => {
    if (node.title.trim().length === 0) {
      issues.push({
        code: "empty_node_title",
        message: `Step ${index + 1} needs a title.`,
        nodeId: node.id,
      });
    }
    if (node.prompt.trim().length === 0) {
      issues.push({
        code: "empty_node_prompt",
        message: `Step ${index + 1} needs a prompt.`,
        nodeId: node.id,
      });
    }
  });
  return issues;
}

/**
 * Grammar issues for the names and slugs the author declares, attributed by
 * collection index so each one can be rendered against the row that owns it
 * (`duplicate_input_name` already follows that convention).
 *
 * A blank name or slug is reported as its own message rather than run through
 * the pattern's wording: "must start with a letter" describes a typo, not an
 * empty field.
 */
function declarationGrammarIssues(
  definition: WorkflowDefinitionV2,
): WorkflowBuilderIssue[] {
  const issues: WorkflowBuilderIssue[] = [];
  (definition.inputs ?? []).forEach((input, index) => {
    if (INPUT_NAME_PATTERN.test(input.name)) {
      return;
    }
    issues.push({
      code: "invalid_input_name",
      message: input.name.length === 0
        ? `Input ${index + 1} needs a name.`
        : `Input name “${input.name}” must start with a letter and use only letters, `
          + "digits, and underscores.",
      ref: input.name,
      index,
    });
  });
  (definition.docTemplates ?? []).forEach((doc, index) => {
    if (DOC_SLUG_PATTERN.test(doc.slug)) {
      return;
    }
    issues.push({
      code: "invalid_doc_slug",
      message: doc.slug.length === 0
        ? `Document ${index + 1} needs a slug.`
        : `Doc slug “${doc.slug}” must be lowercase kebab-case: letters and digits `
          + "joined by single dashes.",
      ref: doc.slug,
      index,
    });
  });
  return issues;
}

/**
 * What a keystroke in the doc-slug field is worth keeping.
 *
 * Only transformations `DOC_SLUG_PATTERN` can never reject are applied — case
 * folding and surrounding whitespace, neither of which the grammar admits — so
 * normalizing can turn an invalid value valid but never the reverse. Anything
 * else the author typed (an underscore, an inner space, a trailing dash) stays
 * as typed and is reported as an error instead: guessing at a slug would save a
 * document under a name no prompt references.
 */
export function normalizeDocSlugInput(value: string): string {
  return value.trim().toLowerCase();
}
