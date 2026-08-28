import type { AgentSummary } from "@anyharness/sdk";
import { isGatewayCapableHarness } from "#product/lib/domain/agents/bundled-agent-registry";
import { agentNeedsInstall } from "#product/lib/domain/agents/status";

/**
 * First-run auth adoption (spec §9, PR 12).
 *
 * When the user has NO selection rows yet, the desktop adopts what the local
 * AnyHarness credential scan already detected, independently per harness:
 * - a harness with detected native auth → nothing to write for that harness
 *   (native is the implicit empty state; the CLI's own login is used)
 * - a harness without detected native auth → preselect the managed gateway
 *   for it, as long as it is installed and the gateway is enabled for the
 *   account
 *
 * One harness's native login must not suppress adoption for any other
 * harness (AGENT_AUTH.md, "First-run adoption settles once": Desktop "adopts
 * the gateway for harnesses without native logins").
 *
 * The plan is only produced when zero selections exist, which keeps the whole
 * flow idempotent: after the first gateway write (or any manual choice in
 * settings) later runs are a no-op.
 */

export interface AuthAdoptionAction {
  harnessKind: string;
  surface: "local";
}

export interface FirstRunAuthAdoptionInput {
  agents: AgentSummary[];
  /** Existing selection rows across all surfaces (enabled or not). */
  selectionCount: number;
  gatewayEnabled: boolean;
}

/**
 * Native credentials detected by the local AnyHarness credential scan.
 *
 * `credentialState === "ready"` is NOT sufficient on its own: readiness is
 * route-aware on every surface (agent-distribution.md's route-aware law —
 * settings and launch must agree), so a harness whose readiness comes from an
 * enrolled gateway/api_key route also reads `ready`. Adoption below must not
 * mistake that for a vendor-CLI login, or one already-routed harness would
 * suppress gateway preselection for every harness.
 *
 * `credentialsFromRoute` is the runtime's provenance flag. It is absent on
 * runtimes that predate it — and those runtimes are also the ones whose
 * `GET /v1/agents` was native-only, so absent correctly means "not from a
 * route".
 *
 * Belt and braces: `planFirstRunAuthAdoption` only runs at zero selections, and
 * a route in effect normally implies a selection row exists, so the two guards
 * overlap. They are not the same guard though — a `state.json` left by another
 * install or a selection set that has not loaded into this scope would slip
 * through the count check — and this predicate is exported and named as a claim
 * about NATIVE auth, so it must be true on its own terms.
 */
export function hasDetectedNativeAuth(agent: AgentSummary): boolean {
  return (
    agent.credentialState === "ready"
    && agent.installState === "installed"
    && !agent.credentialsFromRoute
  );
}

/** Which authentication surface the settings pane shows for a harness. */
export type AgentAuthDisplay = "auth-controls" | "install-gate" | "loading";

/**
 * Decide what to render for a harness's auth section (spec §9).
 *
 * A missing or not-yet-loaded local agent record must NOT fall through to the
 * full auth controls — that would let a user pick a route for a harness that
 * isn't installed/known yet. Missing → install gate; still loading → loading;
 * only a present, installed record gets the auth controls.
 */
export function resolveAgentAuthDisplay(
  localAgent: AgentSummary | null,
  agentsLoading: boolean,
): AgentAuthDisplay {
  if (!localAgent) {
    return agentsLoading ? "loading" : "install-gate";
  }
  return agentNeedsInstall(localAgent) ? "install-gate" : "auth-controls";
}

// The ack-gated, grace-windowed "setting up" step lived here. It is gone: the
// onboarding card is state-bound, never timed (agent_auth §4 cell 4), and
// `resolveAuthSetupEvidence` folds the runtime's status documents instead.

export function planFirstRunAuthAdoption(
  input: FirstRunAuthAdoptionInput,
): AuthAdoptionAction[] {
  if (input.selectionCount > 0) {
    return [];
  }

  if (!input.gatewayEnabled) {
    return [];
  }

  // Each harness adopts independently: detected native creds need no wiring
  // for THAT harness — native is the implicit empty state — but a harness
  // the scan already trusts must not suppress gateway preselection for any
  // other harness on the machine. Existing gateway-support filtering still
  // applies per-harness: a harness with no gateway recipe (cursor — single-
  // source, its only slot is "cursor") can never be handed a gateway action,
  // matching the settings write path's isGatewayCapableHarness guard and the
  // server's selection_rules.py fail-closed ("no gateway recipe").
  return input.agents
    .filter(
      (agent) =>
        agent.installState === "installed"
        && !hasDetectedNativeAuth(agent)
        && isGatewayCapableHarness(agent.kind),
    )
    .map((agent) => ({
      harnessKind: agent.kind,
      surface: "local",
    }));
}
