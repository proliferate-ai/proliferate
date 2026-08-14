import type {
  WorkflowDefinitionRecordV2,
  WorkflowDefinitionV2,
  WorkflowDocTemplateV2,
  WorkflowEdgeV2,
  WorkflowInputV2,
  WorkflowNodeV2,
} from "@proliferate/cloud-sdk";
import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { orderedNodes } from "#product/domain/workflows/definition-v2";

/**
 * The gen-2 builder's draft shape and every pure operation on it: seeding,
 * reordering, edge derivation, and the dirty-comparison projection.
 *
 * Split out of `use-workflow-builder.ts` so the hook holds only React state,
 * the load/seed effect and the save mapping. Nothing here touches React or the
 * network, so the chain rules are testable without rendering.
 */

/**
 * The editable half of a definition. Edges are absent on purpose: the chain is
 * the card order, so an edge list in the draft would be a second source of
 * truth for the same fact. `linearEdges` derives it at read time.
 */
export interface WorkflowBuilderDraft {
  title: string;
  description: string;
  nodes: WorkflowNodeV2[];
  inputs: WorkflowInputV2[];
  docTemplates: WorkflowDocTemplateV2[];
}

export interface WorkflowBuilderActions {
  setTitle: (title: string) => void;
  setDescription: (description: string) => void;
  addNode: () => void;
  removeNode: (nodeId: string) => void;
  updateNode: (nodeId: string, patch: Partial<Omit<WorkflowNodeV2, "id">>) => void;
  moveNodeUp: (nodeId: string) => void;
  moveNodeDown: (nodeId: string) => void;
  addInput: () => void;
  removeInput: (index: number) => void;
  updateInput: (index: number, patch: Partial<WorkflowInputV2>) => void;
  addDocTemplate: () => void;
  removeDocTemplate: (index: number) => void;
  updateDocTemplate: (index: number, patch: Partial<WorkflowDocTemplateV2>) => void;
}

/** Applies one draft-to-draft edit; the hook supplies the state writer. */
export type WorkflowBuilderDraftEditor = (
  edit: (draft: WorkflowBuilderDraft) => WorkflowBuilderDraft,
) => void;

/**
 * Chain edges from card order — the builder's whole graph model. There is no
 * canvas and no edge editing, so "which node runs next" is always "the card
 * below", and `validateDefinitionV2`'s linearity rule is satisfied by
 * construction rather than by a check the UI has to re-implement.
 */
export function linearEdges(nodes: readonly WorkflowNodeV2[]): WorkflowEdgeV2[] {
  const edges: WorkflowEdgeV2[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    edges.push({ from: nodes[index - 1].id, to: nodes[index].id });
  }
  return edges;
}

/** The definition a save would send: the draft, with the chain rendered as edges. */
export function draftToDefinition(draft: WorkflowBuilderDraft): WorkflowDefinitionV2 {
  return {
    schemaVersion: 2,
    nodes: draft.nodes,
    edges: linearEdges(draft.nodes),
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
    nodes: [{ id: "step-1", type: "agent", title: "", prompt: "" }],
    inputs: [],
    docTemplates: [],
  };
}

export function draftFromTemplate(
  template: WorkflowStarterTemplateV2 | null | undefined,
): WorkflowBuilderDraft {
  if (!template) {
    return blankWorkflowBuilderDraft();
  }
  return {
    title: template.title,
    description: template.description,
    ...draftPartsFromDefinition(template.definition),
  };
}

export function draftFromRecord(record: WorkflowDefinitionRecordV2): WorkflowBuilderDraft {
  return {
    title: record.title,
    description: record.description ?? "",
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
    nodes: draft.nodes.map((node) => [
      node.id,
      node.type,
      node.title,
      node.prompt,
      node.model?.agentKind ?? null,
      node.model?.modelId ?? null,
      node.model?.modeId ?? null,
    ]),
    inputs: draft.inputs.map((input) => [input.name, input.description, input.required]),
    docTemplates: draft.docTemplates.map((doc) => [doc.slug, doc.producingNodeId, doc.body]),
  });
}

/** The full edit vocabulary, bound to whichever writer the hook passes in. */
export function workflowBuilderActions(
  editDraft: WorkflowBuilderDraftEditor,
): WorkflowBuilderActions {
  return {
    setTitle: (title) => editDraft((draft) => ({ ...draft, title })),
    setDescription: (description) => editDraft((draft) => ({ ...draft, description })),
    addNode: () => editDraft((draft) => ({
      ...draft,
      nodes: [...draft.nodes, {
        id: nextNodeId(draft.nodes),
        type: "agent",
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
    })),
    updateNode: (nodeId, patch) => editDraft((draft) => ({
      ...draft,
      nodes: draft.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
    })),
    moveNodeUp: (nodeId) => editDraft((draft) => ({
      ...draft,
      nodes: moveNode(draft.nodes, nodeId, -1),
    })),
    moveNodeDown: (nodeId) => editDraft((draft) => ({
      ...draft,
      nodes: moveNode(draft.nodes, nodeId, 1),
    })),
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
    })),
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
        candidate === index ? { ...doc, ...patch } : doc
      ),
    })),
  };
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
 * Cards are seeded in CHAIN order, not array order: a stored definition may
 * list its nodes in any order and express the chain purely in its edges (see
 * `orderedNodes`), and the builder's whole model is that the card order *is*
 * the chain. `orderedNodes` answers `[]` for any definition that does not
 * validate, in which case array order is kept so the invalid document can be
 * opened and repaired rather than emptied.
 */
function draftPartsFromDefinition(definition: WorkflowDefinitionV2): {
  nodes: WorkflowNodeV2[];
  inputs: WorkflowInputV2[];
  docTemplates: WorkflowDocTemplateV2[];
} {
  const chain = orderedNodes(definition);
  const nodes = chain.length > 0 ? chain : definition.nodes;
  return {
    nodes: nodes.map((node) => ({
      ...node,
      ...(node.model ? { model: { ...node.model } } : {}),
    })),
    inputs: (definition.inputs ?? []).map((input) => ({ ...input })),
    docTemplates: (definition.docTemplates ?? []).map((doc) => ({ ...doc })),
  };
}
