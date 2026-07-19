import {
  clampRightPanelWidth,
  normalizeRightPanelDurableState,
  parseRightPanelHeaderEntryKey,
  type RightPanelDurableState,
  type RightPanelMaterializedState,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import { normalizeRightPanelMaterializedState } from "#product/lib/domain/workspaces/shell/right-panel-state-normalization";
import { migrateLegacyRightPanelWorkspaceState } from "#product/lib/domain/workspaces/shell/right-panel-migration";
import {
  isPersistableViewerTarget,
} from "#product/lib/domain/workspaces/viewer/viewer-target";

export function migrateLegacyRightPanelPreferences(args: {
  rightPanelByWorkspace?: Record<string, unknown>;
  rightPanelWidthByWorkspace?: Record<string, number>;
}): {
  durableByWorkspace: Record<string, RightPanelDurableState>;
  materializedByWorkspace: Record<string, RightPanelMaterializedState>;
} {
  const legacyPanels = isRecord(args.rightPanelByWorkspace) ? args.rightPanelByWorkspace : {};
  const legacyWidths = sanitizeRightPanelWidths(args.rightPanelWidthByWorkspace);
  const workspaceIds = new Set([
    ...Object.keys(legacyPanels),
    ...Object.keys(legacyWidths),
  ]);
  const durableByWorkspace: Record<string, RightPanelDurableState> = {};
  const materializedByWorkspace: Record<string, RightPanelMaterializedState> = {};

  for (const workspaceId of workspaceIds) {
    const legacyState = legacyPanels[workspaceId];
    if (!isRecord(legacyState) && legacyWidths[workspaceId] === undefined) {
      continue;
    }
    const { durableState, materializedState } = migrateLegacyRightPanelWorkspaceState({
      state: legacyState,
      width: legacyWidths[workspaceId],
      isCloudWorkspaceSelected: true,
    });
    durableByWorkspace[workspaceId] = durableState;
    materializedByWorkspace[workspaceId] = materializedState;
  }

  return { durableByWorkspace, materializedByWorkspace };
}

export function sanitizeRightPanelDurableByWorkspace(
  value: unknown,
): Record<string, RightPanelDurableState> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const next: Record<string, RightPanelDurableState> = {};
  for (const [workspaceId, rawState] of Object.entries(value)) {
    if (typeof rawState !== "object" || rawState === null) {
      continue;
    }
    next[workspaceId] = normalizeRightPanelDurableState(
      rawState as Partial<RightPanelDurableState>,
    );
  }
  return next;
}

export function sanitizeRightPanelMaterializedByWorkspace(
  value: unknown,
): Record<string, RightPanelMaterializedState> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const next: Record<string, RightPanelMaterializedState> = {};
  for (const [workspaceId, rawState] of Object.entries(value)) {
    if (typeof rawState !== "object" || rawState === null) {
      continue;
    }
    const input = rawState as Partial<RightPanelMaterializedState>;
    const headerOrder = Array.isArray(input.headerOrder)
      ? input.headerOrder.filter(isPersistableRightPanelEntry)
      : undefined;
    const activeEntryKey = input.activeEntryKey
      && isPersistableRightPanelEntry(input.activeEntryKey)
      ? input.activeEntryKey
      : undefined;
    next[workspaceId] = normalizeRightPanelMaterializedState(
      { ...input, activeEntryKey, headerOrder },
      { isCloudWorkspaceSelected: true },
    );
  }
  return next;
}

function isPersistableRightPanelEntry(value: unknown): boolean {
  const entry = parseRightPanelHeaderEntryKey(value);
  return !!entry && (entry.kind !== "viewer" || isPersistableViewerTarget(entry.target));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeRightPanelWidths(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const next: Record<string, number> = {};
  for (const [workspaceId, width] of Object.entries(value)) {
    if (typeof width === "number" && Number.isFinite(width)) {
      next[workspaceId] = clampRightPanelWidth(width);
    }
  }
  return next;
}
