import type { AgentSummary } from "@anyharness/sdk";
import { HOME_SCREEN_LABELS } from "#product/copy/home/home-screen-copy";
import { getAgentDisplayLabel } from "#product/lib/domain/agents/provider-display";
import {
  isStatusGreen,
  statusLabel,
  statusTone,
  type AuthStatusTone,
} from "#product/lib/domain/settings/agent-auth-status-presentation";

/**
 * Onboarding badges bound to the machine's status document (agent_auth spec §4
 * cell 4: "The onboarding card is state-bound, never timed").
 *
 * Two inputs, both facts the runtime holds:
 *
 * - install progress — `installState` (`installing` is still-progressing;
 *   `install_required`/`failed` is an actionable next step). This is harnesses'
 *   field and stays.
 * - auth truth — `authStatus`, the per-harness status document, rendered
 *   verbatim. Nothing here re-derives a state from `readiness`,
 *   `credentialState`, or `cliAuthState`.
 *
 * The card completes when EVERY adopted agent reaches a terminal state: green
 * (a dated observation), an actionable next step, or a STALE document whose last
 * observation is on screen while the runtime re-probes. A stale document is
 * terminal precisely so the card never waits on a probe forever — the dimmed
 * light is a state, not a spinner. Nothing here is timer-driven.
 */

export type OnboardingAgentPhase =
  /** installing artifacts (installState === "installing") */
  | "installing"
  /** the runtime owes this harness its first observation */
  | "waiting"
  /** stale: the last observation is shown while a re-probe runs */
  | "rechecking"
  /** a terminal state whose row routes the user to the pane */
  | "actionable"
  /** launchable: a green, dated observation */
  | "ready";

export interface OnboardingAgentBadge {
  harnessKind: string;
  displayName: string;
  phase: OnboardingAgentPhase;
  /** Badge text — the document's own words, or a pre-document phase. */
  label: string;
  tone: AuthStatusTone;
  /** True while the state is still progressing (spinner, no affordance yet). */
  pending: boolean;
  /** True once the card no longer waits on this agent. */
  terminal: boolean;
  /** True when the agent is launchable and needs no user action. */
  launchable: boolean;
  /**
   * True when the document is stale: the label above IS the last observation and
   * a re-probe is running. Rendered as a marker, never as loading.
   */
  rechecking: boolean;
  /**
   * The install affordance label, or null. Every other state's affordance is
   * the row itself routing to the agent pane, so a null action is never a dead
   * end (see `OnboardingAgentBadge.terminal`).
   */
  actionLabel: string | null;
}

function baseFields(agent: AgentSummary) {
  return {
    harnessKind: agent.kind,
    displayName: agent.displayName,
    rechecking: false,
  };
}

/**
 * Map one adopted agent's real states onto its onboarding badge.
 *
 * The live install signal wins over an absent document: a harness still
 * downloading reads "installing" even before the runtime holds a status row.
 * Once a document exists the badge is a verbatim projection of it — the same
 * document the settings panes render, never a second fold.
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

  const status = agent.authStatus ?? null;
  if (!status) {
    // No document yet. A missing/failed install is an actionable terminal so the
    // user is never stuck; otherwise the runtime simply has not written a status
    // row for this harness — an actionable terminal too, so the card can
    // complete and the pane affordance keeps it from being a dead end.
    return {
      ...base,
      phase: "actionable",
      label:
        agent.installState === "install_required"
        || agent.installState === "failed"
          ? HOME_SCREEN_LABELS.authSetupNeedsInstall
          : HOME_SCREEN_LABELS.authSetupWaitingStatus,
      tone: "neutral",
      pending: false,
      terminal: true,
      launchable: false,
      actionLabel:
        agent.installState === "install_required"
        || agent.installState === "failed"
          ? HOME_SCREEN_LABELS.authSetupInstallAction
          : null,
    };
  }

  const facts = { applied: status.applied ?? null, probe: status.probe };
  const label = statusLabel(facts);
  const tone = statusTone(facts);

  if (isStatusGreen(facts)) {
    return {
      ...base,
      phase: "ready",
      label,
      tone,
      pending: false,
      terminal: true,
      launchable: true,
      // Green stays green while a re-probe runs: the light dims, it never goes
      // out, and a launch the document can satisfy is not gated on the probe.
      rechecking: status.probe.stale,
      actionLabel: null,
    };
  }

  if (status.probe.stale) {
    // Stale WITHOUT any observation is the first probe still running: a bound
    // pending row. Stale WITH one is the dimmed light — terminal, showing the
    // last observation and its re-checking marker rather than a spinner.
    const observed = Boolean(status.probe.at);
    return {
      ...base,
      phase: observed ? "rechecking" : "waiting",
      label,
      tone,
      pending: !observed,
      terminal: observed,
      launchable: false,
      rechecking: true,
      actionLabel: null,
    };
  }

  if (status.probe.verdict === "unverified" && status.applied !== null) {
    // A method is applied and the runtime owes this harness an observation.
    // Bound to the real state — it advances when the probe runs, not on a clock.
    return {
      ...base,
      phase: "waiting",
      label,
      tone,
      pending: true,
      terminal: false,
      launchable: false,
      actionLabel: null,
    };
  }

  // A failed observation, or nothing configured: terminal states whose row
  // routes to the pane.
  return {
    ...base,
    phase: "actionable",
    label,
    tone,
    pending: false,
    terminal: true,
    launchable: false,
    actionLabel: null,
  };
}

/**
 * The badge for an adopted kind not yet present in the agents projection. A
 * bound pending row (spinner, no affordance) named by its kind, keeping the
 * card honest about a harness it is still waiting on.
 *
 * Named through the registry, not the bare wire kind (D-R19): this row exists
 * precisely when the agents projection has nothing to supply a displayName
 * from, so before this it rendered a lowercase "grok" on a Home card.
 */
function missingAgentBadge(kind: string): OnboardingAgentBadge {
  return {
    harnessKind: kind,
    displayName: getAgentDisplayLabel(kind),
    phase: "waiting",
    label: HOME_SCREEN_LABELS.authSetupPreparing,
    tone: "warning",
    pending: true,
    terminal: false,
    launchable: false,
    rechecking: false,
    actionLabel: null,
  };
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
      // The projection has not caught up to this adopted kind. Emit a VISIBLE
      // pending row (named by its kind, the only identity we hold) rather than
      // a card with a silent gap — the agent is at least accounted for, and
      // done stays false until it resolves.
      badges.push(missingAgentBadge(kind));
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
