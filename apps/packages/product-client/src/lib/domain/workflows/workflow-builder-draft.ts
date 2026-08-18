import type {
  WorkflowDefinitionRecordV2,
  WorkflowDefinitionV2,
  WorkflowDocTemplateV2,
  WorkflowEdgeV2,
  WorkflowInputV2,
  WorkflowNodeV2,
} from "@proliferate/cloud-sdk";
import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { validateDefinitionV2 } from "#product/domain/workflows/definition-v2";
import { normalizeDocSlugInput } from "#product/lib/domain/workflows/workflow-builder-validation";

/**
 * The gen-2 builder's draft shape and every pure operation on it: seeding,
 * display ordering, authored edges, and the dirty-comparison projection.
 *
 * Split out of `use-workflow-builder.ts` so the hook holds only React state,
 * the load/seed effect and the save mapping. Nothing here touches React or the
 * network, so the chain rules are testable without rendering.
 */

/**
 * The editable half of a definition. The persisted graph and the structural
 * Input sentinel are separate on purpose: `edges` contains only real-node
 * edges, while `inputConnectedTo` is editor state and is never serialized.
 */
export interface WorkflowBuilderDraft {
  title: string;
  description: string;
  /**
   * The RUNTIME repo-root id a run starts in unless the trigger dialog is told
   * otherwise; `""` = no default. Held as a string rather than `string | null`
   * because it is bound to a `Select` whose empty option is `""`.
   */
  defaultRepoConfigId: string;
  nodes: WorkflowNodeV2[];
  edges: WorkflowEdgeV2[];
  inputConnectedTo: string | null;
  inputs: WorkflowInputV2[];
  docTemplates: WorkflowDocTemplateV2[];
}

export interface WorkflowBuilderActions {
  setTitle: (title: string) => void;
  setDescription: (description: string) => void;
  setDefaultRepoConfigId: (repoConfigId: string) => void;
  addNode: (type?: WorkflowNodeV2["type"]) => void;
  removeNode: (nodeId: string) => void;
  updateNode: (nodeId: string, patch: Partial<Omit<WorkflowNodeV2, "id">>) => void;
  moveNodeUp: (nodeId: string) => void;
  moveNodeDown: (nodeId: string) => void;
  connectNodes: (from: string, to: string) => void;
  removeEdge: (from: string, to: string) => void;
  connectInput: (to: string) => void;
  disconnectInput: () => void;
  addInput: () => void;
  removeInput: (index: number) => void;
  updateInput: (index: number, patch: Partial<WorkflowInputV2>) => void;
  addDocTemplate: () => void;
  removeDocTemplate: (index: number) => void;
  updateDocTemplate: (index: number, patch: Partial<WorkflowDocTemplateV2>) => void;
  replaceDefinition: (definition: WorkflowDefinitionV2) => void;
}

/** Applies one draft-to-draft edit; the hook supplies the state writer. */
export type WorkflowBuilderEditOptions = { coalesceKey?: string };
export type WorkflowBuilderDraftEditor = (
  edit: (draft: WorkflowBuilderDraft) => WorkflowBuilderDraft,
  options?: WorkflowBuilderEditOptions,
) => void;

/** The definition a save would send. The structural Input sentinel is omitted. */
export function draftToDefinition(draft: WorkflowBuilderDraft): WorkflowDefinitionV2 {
  return {
    schemaVersion: 2,
    nodes: draft.nodes,
    edges: draft.edges,
    inputs: draft.inputs,
    docTemplates: draft.docTemplates,
  };
}

/**
 * A node id no sibling holds. Ids are minted rather than derived from the
 * title: the title is edited continuously and the id is referenced by doc
 * templates, so a title-derived id would break `producingNodeId` on every
 * keystroke.
 */
export function nextNodeId(nodes: readonly WorkflowNodeV2[]): string {
  const taken = new Set(nodes.map((node) => node.id));
  let index = nodes.length + 1;
  while (taken.has(`step-${index}`)) {
    index += 1;
  }
  return `step-${index}`;
}

export function blankWorkflowBuilderDraft(): WorkflowBuilderDraft {
  return {
    title: "",
    description: "",
    defaultRepoConfigId: "",
    nodes: [{ id: "step-1", type: "agent", title: "", prompt: "" }],
    edges: [],
    inputConnectedTo: "step-1",
    inputs: [],
    docTemplates: [],
  };
}

/**
 * Starter templates carry no repository: repo-root ids are runtime-local, so a
 * seeded default would name a repository that exists on nobody else's machine.
 */
export function draftFromTemplate(
  template: WorkflowStarterTemplateV2 | null | undefined,
): WorkflowBuilderDraft {
  if (!template) {
    return blankWorkflowBuilderDraft();
  }
  return {
    title: template.title,
    description: template.description,
    defaultRepoConfigId: "",
    ...draftPartsFromDefinition(template.definition),
  };
}

export function draftFromRecord(record: WorkflowDefinitionRecordV2): WorkflowBuilderDraft {
  return {
    title: record.title,
    description: record.description ?? "",
    defaultRepoConfigId: record.defaultRepoConfigId ?? "",
    ...draftPartsFromDefinition(record.definition),
  };
}

/**
 * A field-ordered projection rather than `JSON.stringify(draft)`: object key
 * order varies with how a node was built (seeded, spread-patched, given a
 * `model` it did not have), and a key-order difference would read as an edit
 * that never happened.
 */
export function serializeDraft(draft: WorkflowBuilderDraft): string {
  return JSON.stringify({
    title: draft.title,
    description: draft.description,
    defaultRepoConfigId: draft.defaultRepoConfigId,
    nodes: draft.nodes.map((node) => [
      node.id,
      node.type,
      node.title,
      node.prompt,
      node.model?.agentKind ?? null,
      node.model?.modelId ?? null,
      node.model?.modeId ?? null,
    ]),
    edges: draft.edges.map((edge) => [edge.from, edge.to]),
    inputConnectedTo: draft.inputConnectedTo,
    inputs: draft.inputs.map((input) => [input.name, input.description, input.required]),
    docTemplates: draft.docTemplates.map((doc) => [doc.slug, doc.producingNodeId, doc.body]),
  });
}

/** The full edit vocabulary, bound to whichever writer the hook passes in. */
export function workflowBuilderActions(
  editDraft: WorkflowBuilderDraftEditor,
): WorkflowBuilderActions {
  return {
    setTitle: (title) => editDraft((draft) => ({ ...draft, title }), { coalesceKey: "title" }),
    setDescription: (description) => editDraft(
      (draft) => ({ ...draft, description }),
      { coalesceKey: "description" },
    ),
    setDefaultRepoConfigId: (defaultRepoConfigId) =>
      editDraft((draft) => ({ ...draft, defaultRepoConfigId })),
    addNode: (type = "agent") => editDraft((draft) => ({
      ...draft,
      nodes: [...draft.nodes, {
        id: nextNodeId(draft.nodes),
        type,
        title: "",
        prompt: "",
      }],
    })),
    // A removed node leaves any doc template that named it dangling on
    // purpose: the validator reports `unknown_producing_node` beside that row,
    // which is more honest than silently re-pointing the document elsewhere.
    removeNode: (nodeId) => editDraft((draft) => ({
      ...draft,
      nodes: draft.nodes.filter((node) => node.id !== nodeId),
      edges: draft.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
      inputConnectedTo: draft.inputConnectedTo === nodeId ? null : draft.inputConnectedTo,
    })),
    updateNode: (nodeId, patch) => editDraft((draft) => ({
      ...draft,
      nodes: draft.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
    }), typeof patch.title === "string" || typeof patch.prompt === "string"
      ? { coalesceKey: `node:${nodeId}:${typeof patch.prompt === "string" ? "prompt" : "title"}` }
      : undefined),
    moveNodeUp: (nodeId) => editDraft((draft) => ({
      ...draft,
      nodes: moveNode(draft.nodes, nodeId, -1),
    })),
    moveNodeDown: (nodeId) => editDraft((draft) => ({
      ...draft,
      nodes: moveNode(draft.nodes, nodeId, 1),
    })),
    connectNodes: (from, to) => editDraft((draft) => {
      if (from === to || !draft.nodes.some((node) => node.id === from)
        || !draft.nodes.some((node) => node.id === to)
        || draft.edges.some((edge) => edge.from === from && edge.to === to)) {
        return draft;
      }
      return { ...draft, edges: [...draft.edges, { from, to }] };
    }),
    removeEdge: (from, to) => editDraft((draft) => ({
      ...draft,
      edges: draft.edges.filter((edge) => edge.from !== from || edge.to !== to),
    })),
    connectInput: (to) => editDraft((draft) => draft.nodes.some((node) => node.id === to)
      ? { ...draft, inputConnectedTo: to }
      : draft),
    disconnectInput: () => editDraft((draft) => ({ ...draft, inputConnectedTo: null })),
    addInput: () => editDraft((draft) => ({
      ...draft,
      inputs: [...draft.inputs, { name: "", description: "", required: true }],
    })),
    removeInput: (index) => editDraft((draft) => ({
      ...draft,
      inputs: draft.inputs.filter((_, candidate) => candidate !== index),
    })),
    updateInput: (index, patch) => editDraft((draft) => ({
      ...draft,
      inputs: draft.inputs.map((input, candidate) =>
        candidate === index ? { ...input, ...patch } : input
      ),
    }), typeof patch.name === "string" || typeof patch.description === "string"
      ? { coalesceKey: `input:${index}:${typeof patch.name === "string" ? "name" : "description"}` }
      : undefined),
    addDocTemplate: () => editDraft((draft) => ({
      ...draft,
      docTemplates: [...draft.docTemplates, {
        slug: "",
        producingNodeId: draft.nodes[0]?.id ?? "",
        body: "",
      }],
    })),
    removeDocTemplate: (index) => editDraft((draft) => ({
      ...draft,
      docTemplates: draft.docTemplates.filter((_, candidate) => candidate !== index),
    })),
    updateDocTemplate: (index, patch) => editDraft((draft) => ({
      ...draft,
      docTemplates: draft.docTemplates.map((doc, candidate) =>
        candidate === index ? { ...doc, ...normalizeDocTemplatePatch(patch) } : doc
      ),
    }), typeof patch.slug === "string" || typeof patch.body === "string"
      ? { coalesceKey: `doc:${index}:${typeof patch.body === "string" ? "body" : "slug"}` }
      : undefined),
    replaceDefinition: (definition) => editDraft((draft) => ({
      ...draft,
      ...draftPartsFromDefinition(definition),
    }), { coalesceKey: "json-definition" }),
  };
}

/**
 * Slug normalization happens on the way into the draft, not in the field, so
 * every writer (the panel, a future paste handler) lands the same value the
 * grammar will be checked against.
 */
function normalizeDocTemplatePatch(
  patch: Partial<WorkflowDocTemplateV2>,
): Partial<WorkflowDocTemplateV2> {
  return patch.slug === undefined
    ? patch
    : { ...patch, slug: normalizeDocSlugInput(patch.slug) };
}

function moveNode(
  nodes: readonly WorkflowNodeV2[],
  nodeId: string,
  offset: number,
): WorkflowNodeV2[] {
  const index = nodes.findIndex((node) => node.id === nodeId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= nodes.length) {
    return [...nodes];
  }
  const next = [...nodes];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Preserve authored node and edge ordering exactly. For a valid definition,
 * synthesize the editor-only Input connection to its unique head. Invalid
 * stored graphs get no guessed Input connection and remain repairable.
 */
function draftPartsFromDefinition(definition: WorkflowDefinitionV2): {
  nodes: WorkflowNodeV2[];
  edges: WorkflowEdgeV2[];
  inputConnectedTo: string | null;
  inputs: WorkflowInputV2[];
  docTemplates: WorkflowDocTemplateV2[];
} {
  const nodes = definition.nodes;
  return {
    nodes: nodes.map((node) => ({
      ...node,
      ...(node.model ? { model: { ...node.model } } : {}),
    })),
    edges: definition.edges.map((edge) => ({ ...edge })),
    inputConnectedTo: validateDefinitionV2(definition).length === 0
      ? definitionHeadId(definition)
      : null,
    inputs: (definition.inputs ?? []).map((input) => ({ ...input })),
    docTemplates: (definition.docTemplates ?? []).map((doc) => ({ ...doc })),
  };
}

export function definitionHeadId(definition: WorkflowDefinitionV2): string | null {
  if (definition.nodes.length === 0) return null;
  const incoming = new Set(definition.edges.map((edge) => edge.to));
  const heads = definition.nodes.filter((node) => !incoming.has(node.id));
  return heads.length === 1 ? heads[0].id : null;
}
