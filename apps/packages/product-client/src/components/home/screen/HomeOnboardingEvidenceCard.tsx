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

/**
 * One agent's onboarding row (agent_auth §4 cell 4). The badge label, tone, and
 * diagnostic line are the runtime's status document, verbatim. Every
 * NON-launchable state carries an affordance — the most specific next action the
 * document can name, else the generic route to the agent pane — so no state the
 * card shows is a dead end; a stale document shows its LAST OBSERVATION with a
 * re-checking marker rather than an eternal spinner.
 */
function AuthSetupEvidenceRow({
  badge,
  onOpenAgents,
}: {
  badge: OnboardingAgentBadge;
  onOpenAgents: () => void;
}) {
  const affordanceLabel = badge.launchable
    ? null
    : badge.actionLabel ?? HOME_SCREEN_LABELS.authSetupOpenAgents;
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
              className="z-raised text-ui-sm text-foreground underline underline-offset-2"
              onClick={onOpenAgents}
              data-agent-onboarding-affordance={badge.actionLabel ?? "open-agents"}
            >
              {affordanceLabel}
            </Button>
          ) : null}
        </span>
      </div>
      {badge.detail ? (
        // The document's own diagnostic: the evidence age that makes green mean
        // something, and/or the re-checking marker (stale renders as stale, never
        // as loading — the badge above is the last observation). Nothing is
        // printed here that the document does not state.
        <span
          className="line-clamp-1 pl-7 text-ui-sm text-muted-foreground"
          data-agent-onboarding-detail
          data-agent-onboarding-rechecking={badge.rechecking ? "true" : undefined}
        >
          {badge.detail}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The state-bound "setting up" card (agent_auth §4 cell 4). It lists a per-agent
 * badge bound to the real install state and the runtime's status document, and
 * disappears once every adopted agent is terminal (state-bound completion, no
 * timer). While shown, each non-launchable row carries its affordance.
 */
export function AuthSetupEvidenceCard({
  evidence,
  onOpenAgents,
}: {
  evidence: AuthSetupEvidence;
  onOpenAgents: () => void;
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
          />
        ))}
      </div>
    </div>
  );
}
