import type { HomeModelGate } from "#product/lib/domain/home/home-model-gate";

/**
 * The sentence under the Home composer, and the button beside it.
 *
 * Split out of `home-model-gate.ts` for size only. That file re-exports every
 * name here, and remains the one import path consumers use.
 */

/** The action a blocked notice offers. Each one cures its own state. */
export type HomeModelGateNoticeAction =
  | "agent_settings"
  | "retry_probe"
  | "refetch_launch_options"
  | "check_target_again";

export interface HomeModelGateNotice {
  text: string;
  /** Non-optional on purpose. Every notice a user can reach must give them
   * something to do — a cure where one exists, and navigation where none
   * does. A notice with no action is a dead end, so it must not typecheck. */
  actionLabel: string;
  action: HomeModelGateNoticeAction;
}

export const HOME_MODEL_GATE_AGENT_SETUP_NOTICE = "Finish agent setup to start a chat.";

/**
 * Shown in place of a probe-cured notice when the probe itself was REFUSED.
 *
 * A rejected refresh writes no durable state, so the underlying gate does not
 * move and the same sentence would render again unchanged — a button that
 * appears to do nothing, forever. (A probe that runs and FAILS is already
 * visible: the runtime records `failed_without_observation` and the gate flips
 * to "Couldn't check your models.")
 */
export const HOME_MODEL_GATE_REFRESH_REJECTED_NOTICE = "Couldn't refresh your models.";

/** Shown while a refresh this notice started is still running. */
export const HOME_MODEL_GATE_REFRESHING_NOTICE = "Refreshing your models…";

/**
 * The one notice whose action is navigation rather than a cure.
 *
 * Every agent the runtime knows about is unsupported here, so no probe can
 * ever produce a model and a Refresh would re-read an identical list forever.
 * Stating the fact and leaving nothing to press was the first shape and was
 * wrong for a different reason: with the picker unavailable it left the
 * screen with no affordance at all. So the action goes where the user can see
 * WHICH agents are unsupported and why — it claims to fix nothing.
 */
export const HOME_MODEL_GATE_AGENTS_UNSUPPORTED_NOTICE =
  "No agents are supported on this machine.";

/**
 * The visible line under the composer, or `null` for the states that must stay
 * silent.
 *
 * `selection_required` and `observed_empty` are deliberately silent (owner
 * revisions r2 and r3): both are cured by the enabled picker itself, and a
 * sentence next to a control that already says what to do reads as a dead end
 * rather than an instruction. `querying` / `observation_pending` are silent
 * because work is in flight and the toast already owns that story.
 */
export function resolveHomeModelGateNotice(
  gate: HomeModelGate,
  options: { refreshPending?: boolean; refreshRejected?: boolean } = {},
): HomeModelGateNotice | null {
  const notice = resolveGateNotice(gate);
  // Only a notice whose action FIRES a probe can report on that probe; the
  // others never call the mutation, so its state says nothing about them.
  if (!notice || notice.action !== "retry_probe") {
    return notice;
  }
  // In flight beats refused, and both beat the settled sentence. A probe can
  // take 45s per kind and they run one at a time, so rendering "Models haven't
  // been detected yet." throughout is a terminal claim about work that is
  // still happening — the same lie as the dead end, pointed the other way.
  if (options.refreshPending) {
    return { ...notice, text: HOME_MODEL_GATE_REFRESHING_NOTICE };
  }
  // Only the state whose sentence carries NO information about a probe having
  // run gets overwritten. "Couldn't check your models." already says a probe
  // ran and failed, which is strictly more than a refusal says; replacing it
  // would trade a fact for a weaker one.
  if (options.refreshRejected && gate.kind === "blocked" && gate.reason === "observation_idle") {
    return { ...notice, text: HOME_MODEL_GATE_REFRESH_REJECTED_NOTICE };
  }
  return notice;
}

function resolveGateNotice(gate: HomeModelGate): HomeModelGateNotice | null {
  if (gate.kind !== "blocked") {
    return null;
  }
  switch (gate.reason) {
    case "agent_setup_required":
      return {
        text: HOME_MODEL_GATE_AGENT_SETUP_NOTICE,
        actionLabel: "Agents",
        action: "agent_settings",
      };
    case "observation_failed":
      return {
        text: "Couldn't check your models.",
        actionLabel: "Retry",
        action: "retry_probe",
      };
    // Same words and the same cure as the Settings models section, which
    // solved this state first: an honest "nobody has looked yet" plus a
    // Refresh that looks. Never "Probing…" — nothing is probing.
    case "observation_idle":
      return {
        text: "Models haven't been detected yet.",
        actionLabel: "Refresh",
        action: "retry_probe",
      };
    case "transport_error":
      return {
        text: "Models couldn't be loaded.",
        actionLabel: "Retry",
        action: "refetch_launch_options",
      };
    case "target_unobserved":
      return {
        text: "Proliferate Cloud hasn't reported launch options yet.",
        actionLabel: "Check again",
        action: "check_target_again",
      };
    // The one gate with no cure: no probe can change it, and the picker is
    // unavailable, so without this the state has nothing at all to act on.
    // The action is NAVIGATION, deliberately not Refresh/Retry vocabulary —
    // it does not claim to fix anything, it takes the user to the pane that
    // shows WHICH agents are unsupported and why.
    case "agents_unsupported":
      return {
        text: HOME_MODEL_GATE_AGENTS_UNSUPPORTED_NOTICE,
        actionLabel: "See agents",
        action: "agent_settings",
      };
    case "target_missing":
    case "querying":
    case "observation_pending":
    case "observed_empty":
      return null;
  }
}
