import type { AgentAuthState } from "@proliferate/cloud-sdk";

/**
 * Pure sync logic for the local agent-auth state writer (spec §5): the
 * desktop fetches the server-rendered state.json document for the local
 * surface and pushes it verbatim to the local AnyHarness runtime, which
 * persists it at `<runtime_home>/agent-auth/state.json`.
 *
 * A push happens only when there is something scoped to deliver AND the
 * document differs from the last successful push. Revision-0 documents (the
 * user has no local selections) are never pushed: they carry nothing to
 * render, and the runtime's stale-revision protection would reject them
 * anyway once a scoped document has been persisted.
 */

export interface LocalAuthStatePushPlan {
  shouldPush: boolean;
  fingerprint: string;
}

export function localAuthStateFingerprint(state: AgentAuthState): string {
  return JSON.stringify(state, (_key, value: unknown) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
    return value;
  });
}

export function planLocalAuthStatePush(input: {
  state: AgentAuthState;
  lastPushedFingerprint: string | null;
}): LocalAuthStatePushPlan {
  const fingerprint = localAuthStateFingerprint(input.state);
  if (input.state.revision <= 0) {
    return { shouldPush: false, fingerprint };
  }
  if (input.lastPushedFingerprint === fingerprint) {
    return { shouldPush: false, fingerprint };
  }
  return { shouldPush: true, fingerprint };
}
