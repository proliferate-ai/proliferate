import {
  WORKSPACE_PIN_HISTORY_OBSERVATION_LIMIT,
  type WorkspacePinLocalOrder,
} from "#product/lib/domain/preferences/workspace-ui/model";

export function isSupersededByWorkspacePinHistoryObservation(
  observations: Record<string, WorkspacePinLocalOrder>,
  workspaceIds: readonly string[],
  observedAt: WorkspacePinLocalOrder,
): boolean {
  return workspaceIds.some((workspaceId) => {
    const latest = observations[workspaceId];
    return latest?.rendererEpoch === observedAt.rendererEpoch
      && latest.sequence >= observedAt.sequence;
  });
}

export function recordBoundedWorkspacePinHistoryObservations(
  observations: Record<string, WorkspacePinLocalOrder>,
  workspaceIds: readonly string[],
  observedAt: WorkspacePinLocalOrder,
): Record<string, WorkspacePinLocalOrder> {
  const addressedIds = new Set(workspaceIds.filter((id) => id.trim().length > 0));
  const entries = Object.entries(observations).filter(([id]) => !addressedIds.has(id));
  for (const id of addressedIds) {
    const latest = observations[id];
    entries.push([
      id,
      latest?.rendererEpoch === observedAt.rendererEpoch
        && latest.sequence >= observedAt.sequence
        ? latest
        : observedAt,
    ]);
  }
  return Object.fromEntries(entries.slice(-WORKSPACE_PIN_HISTORY_OBSERVATION_LIMIT));
}
