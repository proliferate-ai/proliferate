import type {
  WorkflowDefinitionV2,
  WorkflowNodeV2,
} from "@proliferate/cloud-sdk";

/**
 * Gen-2 (schema_version 2) prompt token grammar and pure structural
 * validation for `WorkflowDefinitionV2`.
 *
 * Kept beside gen-1's `definition.ts`/`validation.ts` rather than folded into
 * them: schema_version 1 (stages/steps) and schema_version 2 (nodes/edges)
 * are different wire shapes that only share this directory, not a type
 * hierarchy.
 *
 * `parsePromptTokens` is reused by the builder's chip rendering (highlighting
 * `@input:`/`@doc:` references inline as the author types), so it returns
 * ordered segments that cover the entire input string — not just the
 * matches — with text segments carrying everything between tokens.
 */

export type PromptToken =
  | { kind: "text"; text: string }
  | { kind: "input"; name: string; raw: string }
  | { kind: "doc"; slug: string; raw: string };

/**
 * Splits a prompt into an ordered sequence of text/`@input:`/`@doc:`
 * segments. NAME/SLUG match `[a-z0-9_-]+`; a token ends at the first
 * character outside that class, so trailing punctuation (`@doc:slug.`) and
 * unknown sigils (`@foo:`, which never matches `input`/`doc` and so is left
 * as plain text) fall through untouched.
 *
 * Matching is case-insensitive on both the sigil word and the name/slug body
 * (`@INPUT:Name` parses the same as `@input:Name`); the captured name/slug
 * preserves whatever casing the author typed.
 */
export function parsePromptTokens(prompt: string): PromptToken[] {
  // A fresh RegExp per call: a shared module-level `g` regex carries mutable
  // `lastIndex` state across calls, which would corrupt repeat invocations —
  // this parser is expected to run on every keystroke from chip rendering.
  const pattern = /@(input|doc):([a-z0-9_-]+)/gi;
  const tokens: PromptToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prompt)) !== null) {
    const [raw, sigil, name] = match;
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", text: prompt.slice(lastIndex, match.index) });
    }
    if (sigil.toLowerCase() === "input") {
      tokens.push({ kind: "input", name, raw });
    } else {
      tokens.push({ kind: "doc", slug: name, raw });
    }
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < prompt.length) {
    tokens.push({ kind: "text", text: prompt.slice(lastIndex) });
  }
  return tokens;
}

/** Distinct `@input:`/`@doc:` references in a prompt, in first-appearance order. */
export function collectPromptReferences(
  prompt: string,
): { inputs: string[]; docs: string[] } {
  const inputs: string[] = [];
  const docs: string[] = [];
  const seenInputs = new Set<string>();
  const seenDocs = new Set<string>();
  for (const token of parsePromptTokens(prompt)) {
    if (token.kind === "input") {
      if (!seenInputs.has(token.name)) {
        seenInputs.add(token.name);
        inputs.push(token.name);
      }
    } else if (token.kind === "doc") {
      if (!seenDocs.has(token.slug)) {
        seenDocs.add(token.slug);
        docs.push(token.slug);
      }
    }
  }
  return { inputs, docs };
}

export type DefinitionV2IssueCode =
  | "not_linear"
  | "duplicate_node_id"
  | "duplicate_doc_slug"
  | "unknown_input_ref"
  | "unknown_doc_ref"
  | "unknown_producing_node"
  | "empty_nodes"
  | "dangling_edge";

export interface DefinitionV2Issue {
  code: DefinitionV2IssueCode;
  message: string;
  nodeId?: string;
  ref?: string;
}

/**
 * Same rules the server enforces for a gen-2 definition. Empty array = valid.
 *
 * Structural checks (dangling edges, duplicate ids/slugs, unknown producing
 * nodes, unresolved prompt references) are independent of one another and of
 * linearity: linearity is computed over the definition's *distinct* node ids,
 * so a duplicated id or a dangling edge is reported as its own issue without
 * also forcing a `not_linear` issue for an otherwise-linear graph.
 */
export function validateDefinitionV2(def: WorkflowDefinitionV2): DefinitionV2Issue[] {
  const issues: DefinitionV2Issue[] = [];

  if (def.nodes.length === 0) {
    issues.push({ code: "empty_nodes", message: "Add at least one node." });
  }

  const idCounts = new Map<string, number>();
  for (const node of def.nodes) {
    idCounts.set(node.id, (idCounts.get(node.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      issues.push({
        code: "duplicate_node_id",
        message: `Node id “${id}” is used ${count} times; node ids must be unique.`,
        nodeId: id,
      });
    }
  }

  const slugCounts = new Map<string, number>();
  for (const doc of def.docTemplates) {
    slugCounts.set(doc.slug, (slugCounts.get(doc.slug) ?? 0) + 1);
  }
  for (const [slug, count] of slugCounts) {
    if (count > 1) {
      issues.push({
        code: "duplicate_doc_slug",
        message: `Doc template slug “${slug}” is used ${count} times; slugs must be unique.`,
        ref: slug,
      });
    }
  }

  const presentIds = new Set(def.nodes.map((node) => node.id));
  for (const edge of def.edges) {
    if (!presentIds.has(edge.from)) {
      issues.push({
        code: "dangling_edge",
        message: `Edge references unknown source node “${edge.from}”.`,
        ref: edge.from,
      });
    }
    if (!presentIds.has(edge.to)) {
      issues.push({
        code: "dangling_edge",
        message: `Edge references unknown target node “${edge.to}”.`,
        ref: edge.to,
      });
    }
  }

  if (def.nodes.length > 0 && computeLinearOrder(def) === null) {
    issues.push({
      code: "not_linear",
      message: "Nodes and edges must form exactly one linear path covering every node.",
    });
  }

  for (const doc of def.docTemplates) {
    if (!presentIds.has(doc.producingNodeId)) {
      issues.push({
        code: "unknown_producing_node",
        message:
          `Doc template “${doc.slug}” references unknown producing node “${doc.producingNodeId}”.`,
        ref: doc.producingNodeId,
      });
    }
  }

  const inputNames = new Set(def.inputs.map((input) => input.name));
  const docSlugs = new Set(def.docTemplates.map((doc) => doc.slug));
  for (const node of def.nodes) {
    const refs = collectPromptReferences(node.prompt);
    for (const name of refs.inputs) {
      if (!inputNames.has(name)) {
        issues.push({
          code: "unknown_input_ref",
          message: `Node “${node.id}” prompt references unknown input “@input:${name}”.`,
          nodeId: node.id,
          ref: name,
        });
      }
    }
    for (const slug of refs.docs) {
      if (!docSlugs.has(slug)) {
        issues.push({
          code: "unknown_doc_ref",
          message: `Node “${node.id}” prompt references unknown doc template “@doc:${slug}”.`,
          nodeId: node.id,
          ref: slug,
        });
      }
    }
  }

  return issues;
}

/**
 * The definition's nodes in chain order (head → tail). Returns `[]` for any
 * invalid graph (gen-1's `definition.ts`/`validation.ts` has no equivalent
 * "compute an order from a graph" function to establish a throw-vs-return
 * convention; this module follows `validateDefinitionV2`'s own
 * return-a-value, no-exceptions style rather than introduce one).
 */
export function orderedNodes(def: WorkflowDefinitionV2): WorkflowNodeV2[] {
  if (validateDefinitionV2(def).length > 0) {
    return [];
  }
  const order = computeLinearOrder(def);
  if (order === null) {
    return [];
  }
  const byId = new Map(def.nodes.map((node) => [node.id, node] as const));
  return order.map((id) => byId.get(id)!);
}

/**
 * The chain of node ids head → tail, or `null` if the edges over this
 * definition's distinct node ids do not form exactly one linear path
 * covering all of them (branch, merge, cycle, or disconnected components).
 * A single node with zero edges is a valid (length-1) chain.
 */
function computeLinearOrder(def: WorkflowDefinitionV2): string[] | null {
  const presentIds = new Set(def.nodes.map((node) => node.id));
  if (presentIds.size === 0) {
    return [];
  }

  const outNext = new Map<string, string[]>();
  const inPrev = new Map<string, string[]>();
  for (const edge of def.edges) {
    if (!presentIds.has(edge.from) || !presentIds.has(edge.to)) {
      // Dangling edges are reported as their own issue; ignore them here so
      // they don't also masquerade as a linearity violation.
      continue;
    }
    outNext.set(edge.from, [...(outNext.get(edge.from) ?? []), edge.to]);
    inPrev.set(edge.to, [...(inPrev.get(edge.to) ?? []), edge.from]);
  }

  for (const id of presentIds) {
    if ((outNext.get(id)?.length ?? 0) > 1 || (inPrev.get(id)?.length ?? 0) > 1) {
      return null;
    }
  }

  const heads = [...presentIds].filter((id) => (inPrev.get(id)?.length ?? 0) === 0);
  const tails = [...presentIds].filter((id) => (outNext.get(id)?.length ?? 0) === 0);
  if (heads.length !== 1 || tails.length !== 1) {
    return null;
  }

  const order: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = heads[0];
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    order.push(current);
    const next = outNext.get(current);
    current = next && next.length === 1 ? next[0] : undefined;
  }

  if (current !== undefined) {
    // Loop only exits early (with `current` still defined) by revisiting an
    // already-visited id — a cycle that never reaches a natural tail.
    return null;
  }
  if (order.length !== presentIds.size) {
    // Every node passed the degree check but the walk from the single head
    // never reached some of them — a disconnected component (e.g. a separate
    // cycle) coexisting with an otherwise-valid chain.
    return null;
  }
  return order;
}
