import type { WorkflowGraphNodePlacement } from "#product/domain/workflows/graph-layout";

/**
 * Where the author has dragged each card of a workflow, kept on this machine
 * rather than in the definition.
 *
 * `WorkflowDefinitionV2` is a sealed document — the control plane refuses
 * unknown fields and every invocation freezes the document verbatim — so a
 * coordinate has no place on the wire. It is also not a property of the
 * workflow: two people reading the same chain can arrange it differently
 * without either being wrong. So placements live beside the other local
 * preferences, keyed by workflow and then by node.
 */

const WORKFLOW_NODE_LAYOUT_KEY = "workflow_node_layout";

export type WorkflowNodeLayout = Record<string, WorkflowGraphNodePlacement>;

export interface WorkflowNodeLayoutDependencies {
  readPersistedValue(key: string): Promise<unknown>;
  persistValue(key: string, value: unknown): Promise<void>;
}

export async function readWorkflowNodeLayout(
  workflowId: string,
  dependencies: WorkflowNodeLayoutDependencies,
): Promise<WorkflowNodeLayout> {
  const stored = await readStoredLayouts(dependencies);
  return stored[workflowId] ?? {};
}

/**
 * Replaces this workflow's placements. An empty layout drops the workflow's
 * entry entirely, so resetting a graph leaves nothing behind.
 */
export async function writeWorkflowNodeLayout(
  workflowId: string,
  layout: WorkflowNodeLayout,
  dependencies: WorkflowNodeLayoutDependencies,
): Promise<void> {
  const stored = await readStoredLayouts(dependencies);
  const normalized = normalizeLayout(layout);
  if (Object.keys(normalized).length === 0) {
    delete stored[workflowId];
  } else {
    stored[workflowId] = normalized;
  }
  await dependencies.persistValue(WORKFLOW_NODE_LAYOUT_KEY, stored);
}

async function readStoredLayouts(
  dependencies: WorkflowNodeLayoutDependencies,
): Promise<Record<string, WorkflowNodeLayout>> {
  const persisted = await dependencies.readPersistedValue(WORKFLOW_NODE_LAYOUT_KEY);
  if (!isRecord(persisted)) {
    return {};
  }
  const layouts: Record<string, WorkflowNodeLayout> = {};
  for (const [workflowId, layout] of Object.entries(persisted)) {
    const normalized = normalizeLayout(layout);
    if (Object.keys(normalized).length > 0) {
      layouts[workflowId] = normalized;
    }
  }
  return layouts;
}

/**
 * Only finite, non-negative coordinates survive: the canvas measures its
 * content from the origin, so anything else would place a card where the
 * viewport cannot reach it.
 */
function normalizeLayout(value: unknown): WorkflowNodeLayout {
  if (!isRecord(value)) {
    return {};
  }
  const layout: WorkflowNodeLayout = {};
  for (const [nodeKey, placement] of Object.entries(value)) {
    if (!isRecord(placement)) continue;
    const { x, y } = placement;
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    layout[nodeKey] = { x: Math.max(0, x), y: Math.max(0, y) };
  }
  return layout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
