import type { AgentAuthStatusDoc, AgentSummary } from "@anyharness/sdk";
import { HOME_SCREEN_LABELS } from "#product/copy/home/home-screen-copy";
import { getAgentDisplayLabel } from "#product/lib/domain/agents/provider-display";
import {
  isStatusGreen,
  statusEvidenceLine,
  statusLabel,
  statusRecheckingMarker,
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
 * The card completes when EVERY adopted agent reaches a terminal state, and
 * TERMINAL DOES NOT MEAN FINISHED — it means the card is no longer the thing
 * waiting. Every state the document can report is terminal:
 *
 * - green (a dated observation) — launchable;
 * - a stale document — the dimmed light. Its last observation is on screen with
 *   the ruled stale marker ("last checked <age> ago — retrying", founder-ruled
 *   2026-08-27), and a stale document with NOTHING observed is terminal
 *   too: an unobserved harness is an actionable row, never an eternal pending,
 *   because the card cannot see whether a queued probe will ever run;
 * - failed, unverified, nothing-applied — actionable, each carrying the most
 *   specific next action the document supports;
 * - no document at all — actionable ("open agent settings").
 *
 * Exactly TWO states are non-terminal, and each is a bounded job the machine
 * reports the end of: an install in flight (`installState === "installing"` →
 * `installed`, `install_required`, or `failed`), and an adopted kind the agents
 * projection has not answered for yet (the read resolves or errors). Nothing
 * here is timer-driven, and no arm can wait on a state the machine may never
 * report — that is what let the card hang forever and permanently consume one of
 * Home's three onboarding slots.
 */

export type OnboardingAgentPhase =
  /** installing artifacts (installState === "installing") */
  | "installing"
  /** the agents projection has not answered for this adopted kind yet */
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
  /**
   * True while the state is still progressing. Rendered as a spinner; the row
   * still carries the generic pane affordance (a pending row is never a dead
   * end), just no state-specific `actionLabel` yet.
   */
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
   * The diagnostic line under the row, from the document only: the evidence age
   * that makes green mean something, and/or the re-checking marker. Null when the
   * document supports neither — never a placeholder standing in for a cause.
   */
  detail: string | null;
  /**
   * The specific next action, or null for the row's generic "open agent
   * settings". Only causes the DOCUMENT attributes get a specific label; a
   * failure it cannot attribute (gateway credits, for one — that is a cloud fact,
   * not a document field) falls through to the generic action rather than
   * guessing.
   */
  actionLabel: string | null;
}

function baseFields(agent: AgentSummary) {
  return {
    harnessKind: agent.kind,
    displayName: agent.displayName,
    rechecking: false,
    detail: null,
  };
}

function needsInstall(agent: AgentSummary): boolean {
  return agent.installState === "install_required" || agent.installState === "failed";
}

/**
 * The most specific next action the document can honestly name.
 *
 * The deleted derived summary carried a typed per-cause `nextAction`; the status
 * document does not, and the typed per-cause reasons are still unbuilt (spec
 * build list, "the typed per-cause reasons ride the status module"). So this
 * names only what the document itself states: nothing applied, and a detected
 * native login the runtime offers to capture as a seat. Everything else — a
 * failed probe, an exhausted gateway allocation, a bad key — is a cause the
 * document does not attribute, and the row's generic action is the honest floor.
 */
function resolveActionLabel(
  agent: AgentSummary,
  status: AgentAuthStatusDoc,
): string | null {
  if (needsInstall(agent)) {
    return HOME_SCREEN_LABELS.authSetupInstallAction;
  }
  if (status.applied === null) {
    // The runtime offers to capture a login already on this machine as a
    // portable seat (`native` row, `offer: "mint_seat"`) — a better first move
    // than picking a method from scratch.
    const mintable = status.methods.some(
      (row) =>
        row.kind === "native" && row.detected === true && row.offer === "mint_seat",
    );
    return mintable
      ? HOME_SCREEN_LABELS.authSetupUseLoginAction
      : HOME_SCREEN_LABELS.authSetupChooseSourceAction;
  }
  return null;
}

/** The evidence age or the stale marker — the document's own lines. */
function resolveDetail(status: AgentAuthStatusDoc): string | null {
  const facts = { applied: status.applied ?? null, probe: status.probe };
  const lines = [statusEvidenceLine(facts), statusRecheckingMarker(facts)].filter(
    (line): line is string => line !== null,
  );
  return lines.length > 0 ? lines.join(" · ") : null;
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
    // The one job the card genuinely waits on: a live install, whose end the
    // runtime reports as installed / install_required / failed.
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
      label: needsInstall(agent)
        ? HOME_SCREEN_LABELS.authSetupNeedsInstall
        : HOME_SCREEN_LABELS.authSetupWaitingStatus,
      tone: "neutral",
      pending: false,
      terminal: true,
      launchable: false,
      actionLabel: needsInstall(agent)
        ? HOME_SCREEN_LABELS.authSetupInstallAction
        : null,
    };
  }

  const facts = { applied: status.applied ?? null, probe: status.probe };
  const label = statusLabel(facts);
  const tone = statusTone(facts);
  const detail = resolveDetail(status);

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
      detail,
      actionLabel: null,
    };
  }

  if (status.probe.stale) {
    // The dimmed light, both ways round. WITH a last observation the row shows
    // it (phase "rechecking"); with NOTHING observed there is nothing to show,
    // so the row states the document's words and offers the way forward. Either
    // way it is TERMINAL: a queued re-probe is the runtime's business, and the
    // card cannot wait on one it may never see finish.
    const observed = Boolean(status.probe.at);
    return {
      ...base,
      phase: observed ? "rechecking" : "actionable",
      label,
      tone,
      pending: false,
      terminal: true,
      launchable: false,
      rechecking: true,
      detail,
      actionLabel: resolveActionLabel(agent, status),
    };
  }

  // Everything else the document can say — failed, unverified, nothing applied,
  // an unknown verdict from a newer runtime — is terminal and actionable. An
  // applied-but-never-observed harness is included deliberately: the runtime owes
  // it an observation, is not re-probing (the document is not stale), and there
  // is no clock here to advance it, so the honest row is one the user can act on.
  return {
    ...base,
    phase: "actionable",
    label,
    tone,
    pending: false,
    terminal: true,
    launchable: false,
    detail,
    actionLabel: resolveActionLabel(agent, status),
  };
}

/**
 * The badge for an adopted kind the agents projection has not answered for yet.
 * A bound pending row (spinner, generic pane affordance) named by its kind, keeping the
 * card honest about a harness it is still waiting on. Bounded by the read
 * itself: once the projection answers, the kind either has an agent or gets the
 * terminal row below.
 *
 * Named through the registry, not the bare wire kind (D-R19): this row exists
 * precisely when the agents projection has nothing to supply a displayName
 * from, so before this it rendered a lowercase "grok" on a Home card.
 */
function unansweredAgentBadge(kind: string): OnboardingAgentBadge {
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
    detail: null,
    actionLabel: null,
  };
}

/**
 * The badge for an adopted kind the projection HAS answered for and does not
 * list. Terminal with the pane affordance: there is no further state coming, so
 * waiting on it is waiting forever.
 */
function absentAgentBadge(kind: string): OnboardingAgentBadge {
  return {
    harnessKind: kind,
    displayName: getAgentDisplayLabel(kind),
    phase: "actionable",
    label: HOME_SCREEN_LABELS.authSetupWaitingStatus,
    tone: "neutral",
    pending: false,
    terminal: true,
    launchable: false,
    rechecking: false,
    detail: null,
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
 * `agentsByKind` is the agents projection keyed by harness kind.
 * `projectionAnswered` is whether that read has returned at all — an adopted
 * kind missing from an UNANSWERED projection is still-pending (it may yet
 * appear), while one missing from an answered projection is terminal. Without
 * that distinction the fold has to choose between a card that never appears
 * (every kind terminal on the first, empty render) and one that can never
 * complete.
 */
export function resolveAuthSetupEvidence(
  adoptedHarnessKinds: readonly string[],
  agentsByKind: ReadonlyMap<string, AgentSummary>,
  projectionAnswered: boolean,
): AuthSetupEvidence {
  const badges: OnboardingAgentBadge[] = [];
  let done = true;
  for (const kind of adoptedHarnessKinds) {
    const agent = agentsByKind.get(kind);
    if (!agent) {
      // Emit a VISIBLE row either way (named by its kind, the only identity we
      // hold) rather than a card with a silent gap.
      badges.push(
        projectionAnswered ? absentAgentBadge(kind) : unansweredAgentBadge(kind),
      );
      done = done && projectionAnswered;
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
