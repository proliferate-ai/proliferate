import type { AgentSummary } from "@anyharness/sdk";
import { HOME_SCREEN_LABELS } from "#product/copy/home/home-screen-copy";
import {
  labelForDisplay,
  labelForNextAction,
  toneForDisplay,
  type AuthEvidenceTone,
} from "#product/lib/domain/settings/agent-auth-evidence";

/**
 * Evidence-bound onboarding badges (agent-auth.md rung 7, flag
 * agentAuthEvidencePanes).
 *
 * The flag-ON onboarding card replaces the ~20s timer with per-agent badges
 * bound to the REAL states an agent moves through on a fresh install:
 *
 * - install progress — `installState` (`installing` is still-progressing;
 *   `install_required`/`failed` is an actionable next step)
 * - state.json ack + probe/derivation — the runtime's derived `authState`
 *   (`display`, `nextAction`, `facts.probe`)
 *
 * The card completes when EVERY adopted agent reaches a terminal state:
 * launchable (`usable`/`authenticated`) or actionable (a terminal display that
 * carries a next-action affordance routing to the harness pane). A stuck probe
 * (`backoff`) is terminal too — it shows its next-attempt countdown rather than
 * an eternal spinner. Nothing here is timer-driven: completion is a function of
 * the observed states alone.
 */

export type OnboardingAgentPhase =
  /** installing artifacts (installState === "installing") */
  | "installing"
  /** a probe is running or queued */
  | "probing"
  /** acknowledged/preparing, waiting on the next observation (ack, trial) */
  | "waiting"
  /** the probe is in backoff — stuck, but shown with its next attempt */
  | "backoff"
  /** a terminal state whose next action routes the user to the pane */
  | "actionable"
  /** launchable: a green evidence-backed terminal */
  | "ready";

export interface OnboardingAgentBadge {
  harnessKind: string;
  displayName: string;
  phase: OnboardingAgentPhase;
  /** Badge text — the derived display's label, or a pre-derivation phase. */
  label: string;
  tone: AuthEvidenceTone;
  /** True while the state is still progressing (spinner, no affordance yet). */
  pending: boolean;
  /** True once the card no longer waits on this agent. */
  terminal: boolean;
  /** True when the agent is launchable and needs no user action. */
  launchable: boolean;
  /**
   * The single next-action affordance label from `authState.nextAction`, or
   * null when the state offers no explicit action. A null action on a
   * non-launchable terminal is never a dead end: the whole badge routes to the
   * agent pane regardless (see `OnboardingAgentBadge.terminal`).
   */
  actionLabel: string | null;
  /** Backoff only: ISO time of the next probe attempt. */
  nextAttemptAt: string | null;
  /** Backoff only: the last probe failure detail, when the runtime reported it. */
  lastFailureDetail: string | null;
}

function baseFields(agent: AgentSummary) {
  return {
    harnessKind: agent.kind,
    displayName: agent.displayName,
    nextAttemptAt: null as string | null,
    lastFailureDetail: null as string | null,
  };
}

/**
 * Map one adopted agent's real states onto its onboarding badge.
 *
 * The live install signal wins over a not-yet-derived `authState`: a harness
 * still downloading reads "installing" even before the runtime folds a
 * derivation. Once a derivation exists the badge is a verbatim projection of
 * it (label, tone, next action) with the probe lifecycle deciding pending vs
 * terminal — the same derivation the settings panes render, never a re-fold.
 */
export function deriveOnboardingAgentBadge(
  agent: AgentSummary,
): OnboardingAgentBadge {
  const base = baseFields(agent);

  if (agent.installState === "installing") {
    return {
      ...base,
      phase: "installing",
      label: HOME_SCREEN_LABELS.authSetupInstalling,
      tone: "neutral",
      pending: true,
      terminal: false,
      launchable: false,
      actionLabel: null,
    };
  }

  const authState = agent.authState;
  if (!authState) {
    // No derivation yet. A missing/failed install is an actionable terminal so
    // the user is never stuck; otherwise the projection is still filling in —
    // a bound pending state, resolved by the next poll, not a timer.
    if (
      agent.installState === "install_required"
      || agent.installState === "failed"
    ) {
      return {
        ...base,
        phase: "actionable",
        label: HOME_SCREEN_LABELS.authSetupNeedsInstall,
        tone: "neutral",
        pending: false,
        terminal: true,
        launchable: false,
        actionLabel: labelForNextAction("install"),
      };
    }
    return {
      ...base,
      phase: "waiting",
      label: HOME_SCREEN_LABELS.authSetupPreparing,
      tone: "warning",
      pending: true,
      terminal: false,
      launchable: false,
      actionLabel: null,
    };
  }

  const probe = authState.facts.probe;
  const tone = toneForDisplay(authState.display);
  const label = labelForDisplay(authState.display);
  const actionLabel = labelForNextAction(authState.nextAction);

  // A stuck probe is terminal for the card: it shows the backoff and the next
  // attempt, never an eternal spinner.
  if (probe.phase === "backoff") {
    return {
      ...base,
      phase: "backoff",
      label,
      tone,
      pending: false,
      terminal: true,
      launchable: false,
      actionLabel,
      nextAttemptAt: probe.nextAttemptAt ?? null,
      lastFailureDetail: probe.lastFailureDetail ?? null,
    };
  }

  if (probe.phase === "running" || probe.phase === "queued") {
    return {
      ...base,
      phase: "probing",
      label,
      tone,
      pending: true,
      terminal: false,
      launchable: false,
      actionLabel,
    };
  }

  switch (authState.display) {
    case "usable":
    case "authenticated":
      return {
        ...base,
        phase: "ready",
        label,
        tone,
        pending: false,
        terminal: true,
        launchable: true,
        actionLabel: null,
      };
    case "selected":
      // Acknowledged and satisfiable, waiting on the first probe/trial. Bound
      // to the real state — it advances when the probe runs, not on a clock.
      return {
        ...base,
        phase: "waiting",
        label,
        tone,
        pending: true,
        terminal: false,
        launchable: false,
        actionLabel,
      };
    default:
      // not_installed, unsupported, misconfigured, expired, unavailable,
      // installed: terminal states that carry a next action routing to the
      // pane (unsupported's action is "none", and the whole badge still routes
      // there, so no terminal is ever a dead end).
      return {
        ...base,
        phase: "actionable",
        label,
        tone,
        pending: false,
        terminal: true,
        launchable: false,
        actionLabel,
      };
  }
}

export interface AuthSetupEvidence {
  badges: OnboardingAgentBadge[];
  /** True once every adopted agent has reached a terminal state. */
  done: boolean;
}

/**
 * Fold the adopted agents into the card's badges and its completion decision.
 *
 * `agentsByKind` is the agents projection keyed by harness kind. An adopted
 * kind absent from the projection is treated as still-pending (the projection
 * has not caught up), so `done` is never asserted while a harness is unknown.
 */
export function resolveAuthSetupEvidence(
  adoptedHarnessKinds: readonly string[],
  agentsByKind: ReadonlyMap<string, AgentSummary>,
): AuthSetupEvidence {
  const badges: OnboardingAgentBadge[] = [];
  let done = true;
  for (const kind of adoptedHarnessKinds) {
    const agent = agentsByKind.get(kind);
    if (!agent) {
      done = false;
      continue;
    }
    const badge = deriveOnboardingAgentBadge(agent);
    badges.push(badge);
    if (!badge.terminal) {
      done = false;
    }
  }
  if (badges.length === 0) {
    done = false;
  }
  return { badges, done };
}
