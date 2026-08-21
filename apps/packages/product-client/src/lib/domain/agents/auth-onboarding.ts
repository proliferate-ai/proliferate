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

// --- Ack-gated onboarding "setting up" step (agent-auth.md, Proof C7) -------

/**
 * Grace window for the onboarding "setting up" step. Signup/auth never waits
 * on LiteLLM provisioning — this step waits on the first-run adoption's
 * gateway selections reaching APPLIED (the runtime's delivery ack), and if
 * that has not happened within the window the step auto-advances anyway,
 * leaving the ordinary pending indicator to the harness panes. It never
 * hard-blocks and has no error state.
 */
export const AUTH_SETUP_GRACE_MS = 20_000;

/**
 * The step's resolution:
 * - "hidden": first-run adoption has not decided yet, or adopted nothing
 *   (native creds detected / gateway disabled) — there is no step to show.
 * - "settingUp": adopted selections exist whose delivery is not yet
 *   acknowledged (or the enrollment's keys are not minted yet) — show the
 *   "setting up your agents" card.
 * - "applied": every adopted selection reached APPLIED with a synced
 *   enrollment — the step resolved.
 * - "advanced": the grace window passed first — the step auto-advanced; the
 *   panes' pending indicator carries the state from here.
 */
export type AuthSetupStepState = "hidden" | "settingUp" | "applied" | "advanced";

/** The slice of a selection record the step reads (cloud-sdk's shape). */
export interface AuthSetupSelectionRecord {
  harnessKind: string;
  surface: string;
  /**
   * Applied means acknowledged (agent-auth.md). Schema-optional: only an
   * EXPLICIT `false` is pending — absent/null reads as applied, matching the
   * harness panes' read.
   */
  applied?: boolean | null;
}

export function resolveAuthSetupStep(args: {
  /** null until first-run adoption has decided; [] when it adopted nothing. */
  adoptedHarnessKinds: readonly string[] | null;
  /** Local-surface selection rows; undefined while loading (or errored). */
  selections: readonly AuthSetupSelectionRecord[] | undefined;
  /**
   * The enrollment's sync status; anything but "synced" (including an
   * errored/absent enrollment read) means the keys are not minted yet — the
   * same pending state, never an error state.
   */
  enrollmentSyncStatus: string | undefined;
  graceExpired: boolean;
}): AuthSetupStepState {
  const adopted = args.adoptedHarnessKinds;
  if (adopted === null || adopted.length === 0) {
    return "hidden";
  }
  const selections = args.selections;
  const allApplied =
    args.enrollmentSyncStatus === "synced"
    && selections !== undefined
    && adopted.every((harnessKind) =>
      selections.some(
        (record) =>
          record.harnessKind === harnessKind
          && record.surface === "local"
          && record.applied !== false,
      ),
    );
  if (allApplied) {
    return "applied";
  }
  // No hard failure path: a missing record (failed PUT), an errored
  // enrollment read, or slow provisioning all degrade to the grace-bounded
  // pending state and then auto-advance.
  if (args.graceExpired) {
    return "advanced";
  }
  return "settingUp";
}

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
