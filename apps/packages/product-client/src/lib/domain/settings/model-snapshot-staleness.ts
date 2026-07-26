import type { ContextStatus, ModelSnapshotStatus } from "@anyharness/sdk";

/**
 * Model-snapshot staleness display (model-catalog.md "Failure modes":
 * "Snapshot is stale ... rendered as 'needs refresh' ... Age alone never
 * blocks a launch"). Pure projection from the polled status document
 * (`GET /v1/agents/{kind}/model-snapshot`, contract §4) onto the three
 * states a settings surface renders.
 */
export type ModelSnapshotFreshnessState =
  | { kind: "refreshing" }
  | { kind: "stale" }
  | { kind: "fresh"; ageSeconds: number }
  | { kind: "unknown" };

/** The gateway route's fixed auth-context id (`GATEWAY_CONTEXT_ID` in gateway_resolver.rs). */
export const GATEWAY_AUTH_CONTEXT_ID = "gateway";

export function findContextStatus(
  status: ModelSnapshotStatus | undefined,
  authContextId: string,
): ContextStatus | null {
  return status?.contexts.find((context) => context.authContextId === authContextId) ?? null;
}

export function resolveModelSnapshotFreshness(
  context: ContextStatus | null,
): ModelSnapshotFreshnessState {
  if (!context) {
    return { kind: "unknown" };
  }
  if (context.state === "queued" || context.state === "running") {
    return { kind: "refreshing" };
  }
  if (context.stale) {
    return { kind: "stale" };
  }
  if (context.snapshotAgeSeconds != null) {
    return { kind: "fresh", ageSeconds: context.snapshotAgeSeconds };
  }
  return { kind: "unknown" };
}

/** Short duration label for a snapshot age ("5m", "2h", "3d") — no trailing "ago", callers append it. */
export function formatSnapshotAge(ageSeconds: number): string {
  const seconds = Math.max(0, Math.floor(ageSeconds));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
