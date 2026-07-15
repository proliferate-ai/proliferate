import type { AgentAuthState } from "@proliferate/cloud-sdk";
import type { AgentAuthStateDocument } from "@anyharness/sdk";

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

/**
 * Stamp the server-fetched document with the origin of the server that
 * produced it before pushing it to the local runtime (spec §5 twin of the
 * cloud materializer). The runtime's route-auth render plane compares this
 * against the server it currently points at and skips a mismatched document
 * rather than injecting a previous server's gateway credentials — the class of
 * bug a desktop server switch would otherwise hit while the worker is still
 * re-enrolling against the new server.
 */
export function stampIssuingServerOrigin(
  state: AgentAuthState,
  issuingServerOrigin: string,
): AgentAuthStateDocument {
  return { ...state, issuing_server_origin: issuingServerOrigin };
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

/**
 * Whether the local agent-auth state sync (server fetch + push to the local
 * runtime) should run.
 *
 * The local-surface `state.json` carries the gateway AND BYOK route material
 * for LOCAL sessions, which is independent of cloud COMPUTE (E2B sandboxes).
 * Gating this sync on cloud compute (the previous `cloudActive =
 * cloudComputeEnabled && authenticated` coupling) left a gateway-enabled server
 * with cloud compute disabled — e.g. a local-only managed-gateway user, and the
 * qualification local world — unable to launch gateway-routed sessions, because
 * the runtime never received its routes and every gateway harness fell back to
 * "no launchable model". The sync needs only an authenticated session against a
 * reachable server and a healthy local runtime; when there is nothing to
 * deliver the rendered document is revision-0 and `planLocalAuthStatePush`
 * already declines to push it.
 */
export function shouldSyncLocalAuthState(input: {
  authenticated: boolean;
  serverReachable: boolean;
  runtimeHealthy: boolean;
}): boolean {
  return input.authenticated && input.serverReachable && input.runtimeHealthy;
}
