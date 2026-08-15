import { Button } from "#product/primitives/Button";
import { Settings } from "#product/primitives/icons/core";
import { Spinner } from "#product/primitives/Spinner";
import { ProviderIcon } from "#product/primitives/icons/provider-icons";
import { ThinkingText } from "#product/primitives/patterns/ThinkingText";
import { Badge } from "#product/primitives/Badge";
import { HOME_SCREEN_LABELS } from "#product/copy/home/home-screen-copy";
import type {
  AuthSetupEvidence,
  OnboardingAgentBadge,
} from "#product/lib/domain/agents/auth-setup-badges";

/** Coarse remaining-time label until an ISO `nextAttemptAt`, or null if past. */
function formatProbeCountdown(nextAttemptAt: string, now: number): string | null {
  const target = Date.parse(nextAttemptAt);
  if (Number.isNaN(target)) return null;
  const remaining = Math.round((target - now) / 1000);
  if (remaining <= 0) return null;
  if (remaining < 60) return `${remaining}s`;
  return `${Math.round(remaining / 60)}m`;
}

/**
 * One agent's onboarding row (agent-auth.md rung 7, flag agentAuthEvidencePanes).
 * The badge label and tone are the runtime's derived state, verbatim. Every
 * NON-launchable terminal state carries an affordance routing to the agent
 * pane, so no state the card shows is a dead end; a stuck probe (backoff) shows
 * its next-attempt countdown rather than an eternal spinner. Launchable
 * (usable/authenticated) states need no action.
 */
function AuthSetupEvidenceRow({
  badge,
  onOpenAgents,
  now,
}: {
  badge: OnboardingAgentBadge;
  onOpenAgents: () => void;
  now: number;
}) {
  const countdown =
    badge.phase === "backoff" && badge.nextAttemptAt
      ? formatProbeCountdown(badge.nextAttemptAt, now)
      : null;
  const affordanceLabel = badge.launchable
    ? null
    : badge.actionLabel ?? HOME_SCREEN_LABELS.authSetupOpenAgents;
  // The backoff line is shown VISIBLY (spec rung 7): a static next-attempt
  // countdown (non-ticking, matching the rung-6 evidence summary's convention)
  // and the last-failure detail, clamped so a long provider message stays one
  // line rather than reflowing the card.
  const backoffLine =
    badge.phase === "backoff"
      ? [
          countdown ? `Next attempt in ${countdown}.` : "Retrying shortly.",
          badge.lastFailureDetail ?? "",
        ]
          .join(" ")
          .trim()
      : null;
  return (
    <div
      className="flex min-w-0 flex-col gap-0.5"
      data-agent-onboarding-kind={badge.harnessKind}
      data-agent-onboarding-phase={badge.phase}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:icon-paired">
          <ProviderIcon kind={badge.harnessKind} className="icon-paired" />
        </span>
        <span className="truncate text-ui-sm text-foreground">
          {badge.displayName}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {badge.pending ? (
            <Spinner className="icon-paired text-muted-foreground" />
          ) : null}
          <Badge tone={badge.tone} size="micro" data-agent-onboarding-badge={badge.label}>
            {badge.label}
          </Badge>
          {affordanceLabel ? (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              className="z-20 text-ui-sm text-foreground underline underline-offset-2"
              onClick={onOpenAgents}
              data-agent-onboarding-affordance={badge.actionLabel ?? "open-agents"}
            >
              {affordanceLabel}
            </Button>
          ) : null}
        </span>
      </div>
      {backoffLine ? (
        <span
          className="line-clamp-1 pl-7 text-ui-sm text-muted-foreground"
          data-agent-onboarding-next-attempt
        >
          {backoffLine}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Evidence-bound "setting up" card (agent-auth.md rung 7): the flag-ON
 * replacement for the timer card. It lists a per-agent badge bound to the real
 * install/ack/probe states, and disappears once every adopted agent is
 * terminal (state-bound completion, no timer). While shown, each terminal row
 * carries its next-action affordance.
 */
export function AuthSetupEvidenceCard({
  evidence,
  onOpenAgents,
  now = Date.now(),
}: {
  evidence: AuthSetupEvidence;
  onOpenAgents: () => void;
  now?: number;
}) {
  if (evidence.badges.length === 0) {
    return null;
  }
  const anyPending = evidence.badges.some((badge) => badge.pending);
  return (
    <div
      className="group relative flex min-h-26 min-w-0 flex-col gap-2 rounded-composer bg-background px-4 py-3 text-left shadow-subtle ring-[0.5px] ring-border-heavy zoom-stable-hairline-frame"
      data-agent-onboarding-evidence-card
    >
      <span className="flex items-center gap-1.5 text-muted-foreground [&_svg]:icon-control">
        <Settings className="icon-paired" />
        {anyPending ? (
          <ThinkingText
            text={HOME_SCREEN_LABELS.authSetupTitle}
            className="text-ui font-medium text-foreground"
          />
        ) : (
          <span className="text-ui font-medium text-foreground">
            {HOME_SCREEN_LABELS.authSetupTitle}
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        {evidence.badges.map((badge) => (
          <AuthSetupEvidenceRow
            key={badge.harnessKind}
            badge={badge}
            onOpenAgents={onOpenAgents}
            now={now}
          />
        ))}
      </div>
    </div>
  );
}
