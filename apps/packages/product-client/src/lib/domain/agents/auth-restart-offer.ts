import type { AgentAuthSelection, AgentAuthSurface } from "@proliferate/cloud-sdk";
import type { SessionDirectoryEntry } from "#product/lib/domain/sessions/directory/directory-entry";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";

/**
 * Restart-offer domain (agent-auth.md "Applied means acknowledged", Proof C6):
 * auth applies at launch only, so running sessions keep the old world after a
 * switch. Once the switched surface's runtime acknowledges the applied
 * document (the pending→applied flip C-2 built), the surface offers to
 * restart the running sessions of the switched harness on the switched
 * surface — nothing else. Declining is stateless: no badge, no reminder, no
 * persisted record.
 */
export interface AuthSwitchScope {
  harnessKind: string;
  surface: AgentAuthSurface;
}

export function authScopeKey(scope: AuthSwitchScope): string {
  return `${scope.harnessKind}:${scope.surface}`;
}

export function authScopeEquals(a: AuthSwitchScope, b: AuthSwitchScope): boolean {
  return a.harnessKind === b.harnessKind && a.surface === b.surface;
}

/**
 * Scopes (harness, surface) that currently read PENDING: at least one
 * selection record whose delivery the surface's runtime has not acknowledged.
 * Only an explicit `applied: false` is pending — the field is
 * schema-optional, so pre-ack fixtures/clients read as applied (mirrors the
 * editor's `deliveryPending`).
 */
export function pendingAuthScopeKeys(
  selections: readonly AgentAuthSelection[],
): ReadonlySet<string> {
  const pending = new Set<string>();
  for (const record of selections) {
    if (record.applied === false) {
      pending.add(authScopeKey({ harnessKind: record.harnessKind, surface: record.surface }));
    }
  }
  return pending;
}

/**
 * The pending→applied transitions between two observations of the selections
 * list: scopes that were pending before and now have records with none
 * pending. A scope whose records disappeared entirely produces no transition
 * (there is no ack to observe — nothing to anchor the offer on).
 *
 * Returned in the stable order of the current selections list so the LAST
 * element is the latest-written scope (latest-wins re-scoping).
 */
export function authAppliedTransitions(
  previousPending: ReadonlySet<string>,
  selections: readonly AgentAuthSelection[],
): AuthSwitchScope[] {
  if (previousPending.size === 0) {
    return [];
  }
  const pendingNow = pendingAuthScopeKeys(selections);
  const seen = new Set<string>();
  const transitions: AuthSwitchScope[] = [];
  for (const record of selections) {
    const scope: AuthSwitchScope = {
      harnessKind: record.harnessKind,
      surface: record.surface,
    };
    const key = authScopeKey(scope);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (previousPending.has(key) && !pendingNow.has(key)) {
      transitions.push(scope);
    }
  }
  return transitions;
}

/**
 * Which auth surface a session's workspace resolves to. Mirrors
 * `resolveRuntimeTargetForWorkspace`: `cloud:*` synthetic ids run in the
 * user's cloud sandbox (cloud surface), everything else is the local runtime.
 */
export function sessionAuthSurface(
  workspaceId: string | null,
): AgentAuthSurface | null {
  if (workspaceId === null || workspaceId.length === 0) {
    return null;
  }
  if (parseCloudWorkspaceSyntheticId(workspaceId) !== null) {
    return "cloud";
  }
  return "local";
}

/**
 * "Running" for the restart offer: the session's agent process is doing (or
 * awaiting) work — the same active shape the session-recovery path treats as
 * running. Idle/completed/errored/closed sessions are not offered a restart.
 */
export function isRunningSessionEntry(entry: SessionDirectoryEntry): boolean {
  const phase = entry.executionSummary?.phase ?? null;
  return entry.status === "starting"
    || entry.status === "running"
    || phase === "starting"
    || phase === "running"
    || phase === "awaiting_interaction";
}

/**
 * Proof C6 scoping: exactly the running sessions of the switched harness on
 * the switched surface. Nothing else — not the sibling harness, not the other
 * surface, not idle sessions.
 */
export function matchRunningSessions(
  entries: readonly SessionDirectoryEntry[],
  scope: AuthSwitchScope,
): SessionDirectoryEntry[] {
  return entries.filter((entry) =>
    entry.agentKind === scope.harnessKind
    && sessionAuthSurface(entry.workspaceId) === scope.surface
    && isRunningSessionEntry(entry),
  );
}

/** Display label for a listed session (title, else transcript title, else id). */
export function restartSessionLabel(entry: SessionDirectoryEntry): string {
  return entry.title
    ?? entry.activity.transcriptTitle
    ?? entry.sessionId;
}
