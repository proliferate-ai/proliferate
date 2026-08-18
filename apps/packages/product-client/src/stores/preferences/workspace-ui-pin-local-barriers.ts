import {
  WORKSPACE_PIN_LOCAL_BARRIER_LIMIT,
  type WorkspacePinLocalOrder,
} from "#product/lib/domain/preferences/workspace-ui/model";

export function recordBoundedWorkspacePinLocalBarriers(
  barriers: Record<string, WorkspacePinLocalOrder>,
  workspaceIds: readonly string[],
  observedAt: WorkspacePinLocalOrder,
): Record<string, WorkspacePinLocalOrder> {
  const addressedIds = new Set(workspaceIds.filter((id) => id.trim().length > 0));
  const entries = Object.entries(barriers).filter(([id]) => !addressedIds.has(id));
  for (const id of addressedIds) {
    entries.push([id, observedAt]);
  }
  return Object.fromEntries(entries.slice(-WORKSPACE_PIN_LOCAL_BARRIER_LIMIT));
}
