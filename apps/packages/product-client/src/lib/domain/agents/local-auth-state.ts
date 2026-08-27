import type { AgentAuthState } from "@proliferate/cloud-sdk";
import type { AgentAuthStateDocument } from "@anyharness/sdk";

/**
 * Pure sync logic for the local agent-auth state writer (spec §5): the
 * desktop fetches the server-rendered state.json document for the local
 * surface and pushes it verbatim to the local AnyHarness runtime, which
 * persists it at `<runtime_home>/agent-auth/state.json`.
 *
 * A synchronization happens only when the rendered document differs from the
 * last successful operation. A document with no harnesses explicitly clears
 * the runtime state: native auth is an absence of route state, not a
 * lower-sequenced replacement document.
 */

export interface LocalAuthStatePushPlan {
  action: "apply" | "clear" | null;
  fingerprint: string;
}

/**
 * A LOCAL dedupe key over the whole fetched document — deliberately NOT the
 * wire `fingerprint` rider (the server's sha256 of the canonical harnesses
 * array, which is what the ack echoes). This one exists only so an unchanged
 * refetch does not re-push, and it is never sent anywhere.
 */
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
  // `fingerprint` is a server-response rider for the delivery ack (echoed back
  // via POST /state/ack after the runtime confirms the push), never part of
  // the state.json contract the runtime persists — strip it before pushing.
  // `harness_settings` is likewise a response-only rider (the settings pane's
  // read of persisted toggles for harnesses with no enabled selection); the
  // runtime's copy of settings is the per-harness `settings` passenger inside
  // `harnesses`, so the rider is stripped the same way.
  const {
    fingerprint: _fingerprint,
    harness_settings: _harnessSettings,
    ...document
  } = state;
  return { ...document, issuing_server_origin: issuingServerOrigin };
}

export function planLocalAuthStatePush(input: {
  state: AgentAuthState;
  lastPushedFingerprint: string | null;
}): LocalAuthStatePushPlan {
  const fingerprint = localAuthStateFingerprint(input.state);
  if (input.lastPushedFingerprint === fingerprint) {
    return { action: null, fingerprint };
  }
  if (input.state.harnesses.length === 0) {
    return { action: "clear", fingerprint };
  }
  if (input.state.sequence <= 0) {
    return { action: null, fingerprint };
  }
  return { action: "apply", fingerprint };
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
 * deliver the sync explicitly clears any previously persisted route state.
 */
export function shouldSyncLocalAuthState(input: {
  authenticated: boolean;
  serverReachable: boolean;
  runtimeHealthy: boolean;
}): boolean {
  return input.authenticated && input.serverReachable && input.runtimeHealthy;
}
