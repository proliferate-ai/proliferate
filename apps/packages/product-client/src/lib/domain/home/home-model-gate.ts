import type {
  AgentAuthProbePhase,
  AgentReadinessState,
  HarnessLaunchOptionsState,
} from "@anyharness/sdk";

/**
 * Why Home cannot start a chat right now.
 *
 * The old `ModelAvailabilityState` collapsed every reason into
 * `no_launchable_model`, and Home rendered "Finish agent setup to start a
 * chat." for all of them. That sentence is a lie in most of them: an install
 * still running is not unfinished setup, a harness that observed zero models
 * is not unfinished setup, and a picker that already offers rows the user has
 * simply not chosen from is the opposite of unfinished setup. Each reason
 * below is a distinct thing that is true about the world, and each one has its
 * own truthful surface (a notice, an enabled picker, or deliberate silence).
 */
export type HomeModelGateBlockedReason =
  /** No execution target resolves yet, so nothing has been asked for models. */
  | "target_missing"
  /** A cloud target that has not reported launch options. Never inferred from
   * a local observation — the cloud sandbox's copy is the only truth for it. */
  | "target_unobserved"
  /** A launch-option read is in flight and has never answered. */
  | "querying"
  /** The runtime answered, and says a probe or install is still working. */
  | "observation_pending"
  /** Agents are genuinely not set up: readiness is install_required or
   * login_required. The ONLY reason that may say "Finish agent setup". */
  | "agent_setup_required"
  /** A settled observation that found no models. The agents are fine; they
   * reported nothing. */
  | "observed_empty"
  /**
   * Every agent the runtime knows about is unsupported on this machine. The
   * only state in the union with no cure: no probe can produce a model and no
   * button can change that, so its notice offers NAVIGATION to the agents
   * pane rather than a repair that would quietly do nothing.
   */
  | "agents_unsupported"
  /** The probe ran and failed without ever producing an observation. */
  | "observation_failed"
  /**
   * The target settled without ever observing this harness, and nothing will
   * change that on its own: the read answered, no probe is queued or running,
   * and the runtime is not going to schedule one. Harnesses excluded from
   * automatic probing (`AUTO_PROBE_EXCLUDED_HARNESSES`) live here permanently
   * until a user asks. Reporting it as in-flight is the "Probing…" that never
   * ends; reporting nothing at all is a dead end with no cure on screen.
   *
   * A `backoff` probe phase lands here too, deliberately. `probe_phase` only
   * returns `Backoff` when the durable row is NOT in flight — an in-flight row
   * is forced to `queued`/`running` — so backoff always arrives on a SETTLED
   * row (an `observed` or `last_good_after_failure` row with zero models and a
   * retry armed for a future time), never on a `detecting` one. Calling it
   * in-flight would map it to `observation_pending`, which is not polled, and
   * so would manufacture a new permanently-silent state — the exact bug this
   * reason removes. The sentence is true of it, and `refresh_now` never
   * consults the backoff timer, so the cure works immediately.
   */
  | "observation_idle"
  /** The launch-option request itself failed; there is no state to read. */
  | "transport_error";

export type HomeModelGate =
  | { kind: "launchable" }
  | { kind: "selection_required" }
  | { kind: "blocked"; reason: HomeModelGateBlockedReason };

/** One harness's launch-option read, as the gate needs to see it. */
export interface HomeModelGateObservation {
  harnessKind: string;
  /** `null` while the read has produced no response at all. */
  state: HarnessLaunchOptionsState | null;
  /** `null` when the runtime does not own the probe engine (or is not local). */
  probePhase: AgentAuthProbePhase | null;
  /** The read has never answered. */
  isPending: boolean;
  /** The read failed at the transport layer. */
  isError: boolean;
}

export interface HomeModelGateInput {
  /** False when no execution target resolves. */
  hasLaunchTarget: boolean;
  /** Cloud-only: the target exists but has never reported launch options. */
  isTargetUnobserved: boolean;
  /** The effective selection names a model that actually exists in a group. */
  hasExactSelection: boolean;
  /** How many model rows the picker can offer across every group. */
  offeredModelCount: number;
  observations: readonly HomeModelGateObservation[];
  /** Readiness of every agent the catalog knows about. */
  agentReadiness: readonly AgentReadinessState[];
  /** An install/reconcile job is working right now. */
  isInstalling: boolean;
  /** The agent catalog's own HTTP read has never answered. */
  isCatalogLoading: boolean;
  /** The agent catalog's own HTTP read failed. */
  hasCatalogError: boolean;
}

/**
 * Resolves the one gate Home renders from.
 *
 * Precedence, and why it is this order:
 *  1. No target, or a target that never reported: nothing downstream can be
 *     true about models yet, and a cloud target must never read a local
 *     observation to fill the gap.
 *  2. An exact valid selection wins over every diagnostic. A refresh in flight
 *     or a last-good-after-failure snapshot still has real, launchable rows.
 *  3. Rows exist but nothing is selected: selection_required. There is NO
 *     first-model fallback anywhere in this file — offering rows and selecting
 *     one are different acts, and the product only performs the first.
 *  4. In-flight reasons, so a running probe is never reported as a settled
 *     failure or as unfinished setup.
 *  5. Settled reasons, most specific first.
 */
export function resolveHomeModelGate(input: HomeModelGateInput): HomeModelGate {
  if (!input.hasLaunchTarget) {
    return blocked("target_missing");
  }
  if (input.isTargetUnobserved) {
    return blocked("target_unobserved");
  }
  if (input.hasExactSelection) {
    return { kind: "launchable" };
  }
  if (input.offeredModelCount > 0) {
    return { kind: "selection_required" };
  }

  if (
    input.isCatalogLoading
    || input.observations.some((observation) =>
      observation.isPending && !observation.isError
    )
  ) {
    return blocked("querying");
  }
  if (input.isInstalling || input.observations.some(isProbeInFlight)) {
    return blocked("observation_pending");
  }

  if (input.agentReadiness.some(readinessNeedsSetup)) {
    return blocked("agent_setup_required");
  }
  // Before any "nobody has looked" story: nothing CAN look. Requires at least
  // one known agent, so an empty catalog never claims this.
  if (
    input.agentReadiness.length > 0
    && input.agentReadiness.every((readiness) => readiness === "unsupported")
  ) {
    return blocked("agents_unsupported");
  }
  if (input.observations.some((observation) => observation.state === "observed_empty")) {
    return blocked("observed_empty");
  }
  if (
    input.observations.some((observation) =>
      observation.state === "failed_without_observation"
    )
  ) {
    return blocked("observation_failed");
  }
  if (input.hasCatalogError || input.observations.some((observation) => observation.isError)) {
    return blocked("transport_error");
  }
  if (input.observations.some(isSettledUnobservedHarness)) {
    return blocked("observation_idle");
  }

  // Residual: a target exists, nothing is in flight, nothing failed, and no
  // harness has produced an observation. Whatever combination of inputs got
  // here, the world is not going to move without the user, so the residual is
  // the state that says exactly that AND offers the cure. It is deliberately
  // NOT `querying`: a silent, actionless "still asking" that no longer asks is
  // the dead end this gate exists to remove.
  return blocked("observation_idle");
}

/**
 * A harness the target has settled on without ever observing it.
 *
 * `detecting` is the runtime's pre-observation state, and `probePhase` is what
 * says whether anything is still working on it. `idle` means nothing is: no
 * probe is queued, none is running, and none will be scheduled automatically
 * for an excluded harness. Combined with a read that has answered and did not
 * fail, that is an unambiguous "ask me and I will look".
 */
export function isSettledUnobservedHarness(
  observation: HomeModelGateObservation,
): boolean {
  return observation.state === "detecting"
    && observation.probePhase === "idle"
    && !observation.isPending
    && !observation.isError;
}

/**
 * `readiness` values that make "Finish agent setup to start a chat." true.
 *
 * Deliberately an exhaustive `switch` with NO `default:` arm: a new
 * `AgentReadinessState` variant must fail to compile here rather than fall
 * silently into whichever residual happens to be last. The mapping below is
 * today's answer; the exhaustiveness is the durable part.
 *
 * The rule is the product's own `getAgentsNeedingSetup` rule — not ready and
 * not unsupported — and it is the same rule for the same reason: every one of
 * these four states is a thing the user resolves in the Agents pane, which is
 * exactly where the notice's action sends them.
 *
 *  - `credentials_required`: the user holds the missing key. Leaving it out
 *    was a regression against main, which said "Finish agent setup" here.
 *  - `error`: the runtime could not evaluate the agent. Re-probing it would
 *    loop on the same failure; the Agents pane is where the error is shown.
 *  - `unsupported`: NOT setup. Nothing the user can do makes this agent run on
 *    this machine, so it must never speak for the whole catalog — a single
 *    unsupported agent alongside working ones would otherwise pin Home to a
 *    setup notice forever. When it is the ONLY thing the catalog holds, the
 *    dedicated `agents_unsupported` reason states that plainly instead of
 *    offering a Refresh that re-reads the same list forever.
 */
export function readinessNeedsSetup(readiness: AgentReadinessState): boolean {
  switch (readiness) {
    case "install_required":
    case "login_required":
    case "credentials_required":
    case "error":
      return true;
    case "ready":
    case "unsupported":
      return false;
  }
}

function isProbeInFlight(observation: HomeModelGateObservation): boolean {
  return observation.probePhase === "queued" || observation.probePhase === "running";
}

/**
 * Whether this gate's cure is a NEW probe rather than another read.
 *
 * The retry path reads THIS, keyed on the gate the resolver already produced,
 * rather than re-deriving the condition from the observations. `observation_idle`
 * is reached from two arms — a settled-unobserved harness and the residual —
 * and a retry that re-checked only the first arm's predicate promised a
 * Refresh to everything arriving through the second and then delivered a
 * re-read of the same durable row. One fact, read once, cannot disagree with
 * itself; two predicates over the same inputs can, and did.
 */
export function homeModelGateNeedsNewProbe(gate: HomeModelGate): boolean {
  return gate.kind === "blocked" && gate.reason === "observation_idle";
}

function blocked(reason: HomeModelGateBlockedReason): HomeModelGate {
  return { kind: "blocked", reason };
}

/** Every gate value, for exhaustive table-driven tests. */
export const HOME_MODEL_GATE_BLOCKED_REASONS = [
  "target_missing",
  "target_unobserved",
  "querying",
  "observation_pending",
  "agent_setup_required",
  "observed_empty",
  "agents_unsupported",
  "observation_failed",
  "observation_idle",
  "transport_error",
] as const satisfies readonly HomeModelGateBlockedReason[];

/**
 * What the picker trigger is allowed to claim, derived from the gate.
 *
 * Both this and `resolveHomeModelGateNotice` are functions of the SAME gate,
 * which is what keeps ruling 2 checkable in one place: `agent_setup_required`
 * maps to `unavailable` here and to the setup notice there. That is a property
 * of these two mappings, ENFORCED BY TESTS at both seams — the notice/trigger
 * pairing and the trigger's own enablement rule — not by the union's shape.
 * Nothing in the types stops a caller passing no `availability` at all (it
 * defaults to `"ready"`) or passing `hasAgents: false` next to a notice, so
 * the tests, not the compiler, are the guarantee.
 */
export type HomeModelSelectorAvailability =
  /** Rows are exactly what the target observed; choose freely. */
  | "ready"
  /** No observation exists yet; choice is impossible by construction. */
  | "observation_pending"
  /** Agents answered and reported no models. The picker is the cure path. */
  | "observed_empty"
  /** A failed or missing observation: the picker has nothing truthful to show. */
  | "unavailable";

export function resolveHomeModelSelectorAvailability(
  gate: HomeModelGate,
): HomeModelSelectorAvailability {
  if (gate.kind !== "blocked") {
    return "ready";
  }
  switch (gate.reason) {
    case "observed_empty":
      return "observed_empty";
    case "querying":
    case "observation_pending":
      return "observation_pending";
    case "target_missing":
    case "target_unobserved":
    case "agent_setup_required":
    case "agents_unsupported":
    case "observation_failed":
    case "observation_idle":
    case "transport_error":
      return "unavailable";
  }
}

// Notice resolution lives in a sibling module purely for size; this file stays
// the one import path every consumer uses, so nothing downstream moves.
export {
  HOME_MODEL_GATE_AGENT_SETUP_NOTICE,
  HOME_MODEL_GATE_AGENTS_UNSUPPORTED_NOTICE,
  HOME_MODEL_GATE_REFRESHING_NOTICE,
  HOME_MODEL_GATE_REFRESH_REJECTED_NOTICE,
  resolveHomeModelGateNotice,
} from "#product/lib/domain/home/home-model-gate-notice";
export type {
  HomeModelGateNotice,
  HomeModelGateNoticeAction,
} from "#product/lib/domain/home/home-model-gate-notice";

/** The disabled Send's tooltip and accessible name while a model is unchosen. */
export const HOME_MODEL_GATE_SEND_BLOCKED_REASON = "Choose a model";

/** What the sr-only status region says when Enter is refused. */
export const HOME_MODEL_GATE_REFUSAL_ANNOUNCEMENT = "Choose a model before sending";

/**
 * The live-region text for the Nth refusal.
 *
 * A screen reader announces a status region when its text CHANGES, so a second
 * identical refusal would be silent. Appending anything (a count, a bullet)
 * would stack and would put numerals into a region ruling 6 keeps free of
 * them, so the two renderings differ only by a trailing no-break space: the
 * same sentence, a different string, nothing read out that is not the reason.
 * The nudge is a NO-BREAK space: accessible-name computation collapses a
 * trailing ordinary space, which would make the two renderings identical.
 */
export function resolveHomeModelGateRefusalAnnouncement(refusalCount: number): string {
  if (refusalCount <= 0) {
    return "";
  }
  return refusalCount % 2 === 1
    ? HOME_MODEL_GATE_REFUSAL_ANNOUNCEMENT
    : `${HOME_MODEL_GATE_REFUSAL_ANNOUNCEMENT}\u00a0`;
}

/** The picker trigger the refusal moves focus to. */
export const HOME_MODEL_TRIGGER_SELECTOR = "[data-composer-model-trigger]";
