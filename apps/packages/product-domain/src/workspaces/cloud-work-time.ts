import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

export function dedupeCloudWorkspaces(
  workspaces: readonly CloudWorkspaceSummary[],
): CloudWorkspaceSummary[] {
  const byId = new Map<string, CloudWorkspaceSummary>();
  for (const workspace of workspaces) {
    const existing = byId.get(workspace.id);
    if (existing) {
      byId.set(workspace.id, mergeCloudWorkspaceSummary(existing, workspace));
    } else {
      byId.set(workspace.id, workspace);
    }
  }
  return [...byId.values()];
}

export function cloudWorkLastActivityMs(
  workspace: Pick<CloudWorkspaceSummary, "lastActivityAt" | "updatedAt" | "createdAt" | "lastSessionSummary">,
): number {
  return parseTime(cloudWorkLastActivityIso(workspace));
}

export function cloudWorkLastActivityIso(
  workspace: Pick<CloudWorkspaceSummary, "lastActivityAt" | "updatedAt" | "createdAt" | "lastSessionSummary">,
): string | null {
  return workspace.lastSessionSummary?.lastEventAt
    ?? workspace.lastActivityAt
    ?? workspace.updatedAt
    ?? workspace.createdAt
    ?? null;
}

export function parseTime(value?: string | null): number {
  return value ? Date.parse(value) || 0 : 0;
}

export function relativeTimeLabel(timeMs: number, nowMs: number): string {
  if (!timeMs) {
    return "unknown";
  }
  const deltaSeconds = Math.max(0, Math.floor((nowMs - timeMs) / 1000));
  if (deltaSeconds < 60) {
    return "now";
  }
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h`;
  }
  return `${Math.floor(deltaHours / 24)}d`;
}

function workspaceCompletenessScore(workspace: CloudWorkspaceSummary): number {
  let score = 0;
  if (workspace.exposure) score += 4;
  if (workspace.lastSessionSummary) score += 3;
  if (workspace.lastActivityAt) score += 2;
  if (workspace.origin) score += 1;
  if (workspace.creatorContext) score += 1;
  return score;
}

export function mergeCloudWorkspaceSummary(
  existing: CloudWorkspaceSummary,
  incoming: CloudWorkspaceSummary,
): CloudWorkspaceSummary {
  const primary = workspaceCompletenessScore(incoming) >= workspaceCompletenessScore(existing)
    ? incoming
    : existing;
  const secondary = primary === incoming ? existing : incoming;
  return {
    ...secondary,
    ...primary,
    origin: primary.origin ?? secondary.origin,
    creatorContext: primary.creatorContext ?? secondary.creatorContext,
    directTargetContext: primary.directTargetContext ?? secondary.directTargetContext,
    exposure: primary.exposure ?? secondary.exposure,
    exposureState: primary.exposureState ?? secondary.exposureState,
    lastActivityAt: latestIso(primary.lastActivityAt, secondary.lastActivityAt),
    lastError: primary.lastError ?? secondary.lastError,
    lastSessionSummary: primary.lastSessionSummary ?? secondary.lastSessionSummary,
    runtime: primary.runtime ?? secondary.runtime,
    statusDetail: primary.statusDetail ?? secondary.statusDetail,
  };
}

function latestIso(left?: string | null, right?: string | null): string | null {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
