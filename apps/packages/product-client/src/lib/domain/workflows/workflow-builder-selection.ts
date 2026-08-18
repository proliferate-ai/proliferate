import type { WorkflowBuilderDraft } from "#product/lib/domain/workflows/workflow-builder-draft";

/**
 * What the builder inspector edits: one chain step, one context doc, or —
 * through the structural input card that heads the chain — the workflow itself
 * (description, default repository, declared inputs).
 */
export type WorkflowBuilderSelection =
  | { kind: "node"; id: string }
  | { kind: "doc"; index: number }
  | { kind: "input" };

/**
 * A stale selection (removed step, removed doc) falls back to the first step,
 * then to the input card — the inspector always edits something real.
 */
export function resolveWorkflowBuilderSelection(
  selection: WorkflowBuilderSelection | null,
  draft: WorkflowBuilderDraft,
): WorkflowBuilderSelection {
  if (selection?.kind === "node" && draft.nodes.some((node) => node.id === selection.id)) {
    return selection;
  }
  if (selection?.kind === "doc" && selection.index < draft.docTemplates.length) {
    return selection;
  }
  if (selection?.kind === "input") {
    return selection;
  }
  return draft.nodes.length > 0
    ? { kind: "node", id: draft.nodes[0].id }
    : { kind: "input" };
}
