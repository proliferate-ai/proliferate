import type {
  WorkflowDefinitionV2,
  WorkflowNodeV2,
} from "@proliferate/cloud-sdk";
import {
  NODE_ID_PATTERN,
  collectPromptReferences,
  describeMalformedReference,
} from "./definition-v2-references";

/**
 * Gen-2 (schema_version 2) pure structural validation for
 * `WorkflowDefinitionV2`. The prompt reference grammar it applies lives in
 * `definition-v2-references.ts` and is re-exported here so consumers keep one
 * import path for the pair.
 *
 * Kept beside gen-1's `definition.ts`/`validation.ts` rather than folded into
 * them: schema_version 1 (stages/steps) and schema_version 2 (nodes/edges)
 * are different wire shapes that only share this directory, not a type
 * hierarchy.
 */

export {
  DOC_SLUG_PATTERN,
  INPUT_NAME_PATTERN,
  NODE_ID_PATTERN,
  collectPromptReferences,
  parsePromptTokens,
} from "./definition-v2-references";
export type {
  MalformedPromptReference,
  MalformedPromptReferenceReason,
  PromptReferences,
  PromptToken,
} from "./definition-v2-references";

export type DefinitionV2IssueCode =
  | "not_linear"
  | "invalid_node_id"
  | "duplicate_node_id"
  | "duplicate_input_name"
  | "duplicate_doc_slug"
  | "malformed_reference"
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
  /**
   * Position within the collection the issue belongs to, when the shared
   * contract fixtures pin one: `duplicate_input_name` is attributed to the
   * repeated entry (`inputs.1.name`), not to the first declaration.
   */
  index?: number;
}

/**
 * Same rules the server enforces for a gen-2 definition. Empty array = valid.
 *
 * Structural checks (dangling edges, duplicate ids/names/slugs, unknown
 * producing nodes, malformed and unresolved prompt references) are independent
 * of one another and of linearity: linearity is computed over the definition's
 * *distinct* node ids, so a duplicated id or a dangling edge is reported as its
 * own issue without also forcing a `not_linear` issue for an otherwise-linear
 * graph.
 *
 * Node ids are checked against the shared node-id grammar where they are
 * declared; references to a node id from an edge or a doc template are covered
 * by `dangling_edge`/`unknown_producing_node` instead of reported twice.
 * Declared input names and doc slugs are grammar-checked by the control plane's
 * wire models, not here — this validator sees whatever the builder holds.
 */
export function validateDefinitionV2(def: WorkflowDefinitionV2): DefinitionV2Issue[] {
  const issues: DefinitionV2Issue[] = [];
  // `edges` is required on the wire (the runtime rejects a definition without
  // it); `inputs`/`docTemplates` may be omitted, and omitted means "none".
  const edges = def.edges;
  const inputs = def.inputs ?? [];
  const docTemplates = def.docTemplates ?? [];

  if (def.nodes.length === 0) {
    issues.push({ code: "empty_nodes", message: "Add at least one node." });
  }

  for (const node of def.nodes) {
    if (!NODE_ID_PATTERN.test(node.id)) {
      issues.push({
        code: "invalid_node_id",
        message:
          `Node id “${node.id}” must start with a letter and use only letters, ` +
          "digits, underscores, and dashes.",
        nodeId: node.id,
      });
    }
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

  // Attributed to the repeated declaration, matching the contract fixture's
  // `inputs.1.name`, so the builder can point at the entry the author has to
  // rename rather than at the one that was already fine.
  const seenInputNames = new Set<string>();
  inputs.forEach((input, index) => {
    if (seenInputNames.has(input.name)) {
      issues.push({
        code: "duplicate_input_name",
        message:
          `Input name “${input.name}” is already declared; input names must be unique.`,
        ref: input.name,
        index,
      });
      return;
    }
    seenInputNames.add(input.name);
  });

  const slugCounts = new Map<string, number>();
  for (const doc of docTemplates) {
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
  for (const edge of edges) {
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

  for (const doc of docTemplates) {
    if (!presentIds.has(doc.producingNodeId)) {
      issues.push({
        code: "unknown_producing_node",
        message:
          `Doc template “${doc.slug}” references unknown producing node “${doc.producingNodeId}”.`,
        ref: doc.producingNodeId,
      });
    }
  }

  const inputNames = new Set(inputs.map((input) => input.name));
  const docSlugs = new Set(docTemplates.map((doc) => doc.slug));
  for (const node of def.nodes) {
    const refs = collectPromptReferences(node.prompt);
    for (const malformed of refs.malformed) {
      issues.push({
        code: "malformed_reference",
        message:
          `Node “${node.id}” prompt has a malformed reference “${malformed.raw}”: ` +
          `${describeMalformedReference(malformed)}.`,
        nodeId: node.id,
        ref: malformed.raw,
      });
    }
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
