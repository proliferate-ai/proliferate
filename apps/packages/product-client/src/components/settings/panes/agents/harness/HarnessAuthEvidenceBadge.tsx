import { RefreshCw } from "#product/primitives/icons/platform";
import { Badge } from "#product/primitives/Badge";
import { IconButton } from "#product/primitives/IconButton";
import {
  evidenceAgeLine,
  labelForDisplay,
  labelForNextAction,
  presentHandoff,
  toneForDisplay,
  type AgentAuthState,
} from "#product/lib/domain/settings/agent-auth-evidence";

/**
 * The evidence-backed status badge (ADR agent-auth rung 6). Renders EXCLUSIVELY
 * from the runtime's derived `authState`: the display name sets the label and
 * tone, green (success) is reachable ONLY for `usable`/`authenticated` because
 * `toneForDisplay` says so and those are the runtime's evidence-backed
 * terminals, and a green badge carries its evidence age ("verified 2m ago").
 * There is no local derivation and no readiness fallback — the two behaviors
 * that produced PRO-252's false greens.
 */
export function HarnessAuthEvidenceBadge({
  authState,
  refreshing,
  onRefresh,
  "data-harness-status": dataHarnessStatus,
}: {
  authState: AgentAuthState;
  refreshing: boolean;
  onRefresh: () => void;
  "data-harness-status"?: string;
}) {
  const tone = toneForDisplay(authState.display);
  const ageLine = evidenceAgeLine(authState);
  return (
    <>
      <Badge
        tone={tone}
        data-harness-status={dataHarnessStatus}
        data-harness-display={authState.display}
      >
        <span
          aria-hidden
          className="icon-status mr-1.5 inline-block shrink-0 rounded-full bg-current"
        />
        {labelForDisplay(authState.display)}
        {ageLine ? (
          <span className="ml-1.5 font-normal opacity-70">{ageLine}</span>
        ) : null}
      </Badge>
      <IconButton
        aria-label="Refresh status"
        title="Refresh status"
        disabled={refreshing}
        onClick={onRefresh}
      >
        <RefreshCw className={`icon-paired ${refreshing ? "animate-spin" : ""}`} />
      </IconButton>
    </>
  );
}

/** Coarse remaining-time label until an ISO `nextAttemptAt`, or null if past. */
function formatCountdown(nextAttemptAt: string, now: number): string | null {
  const target = Date.parse(nextAttemptAt);
  if (Number.isNaN(target)) return null;
  const remaining = Math.round((target - now) / 1000);
  if (remaining <= 0) return null;
  if (remaining < 60) return `${remaining}s`;
  return `${Math.round(remaining / 60)}m`;
}

/**
 * The lead the flag-ON pane opens with (ADR agent-auth rung 6): the derived
 * state said in a sentence plus the single next action, then the probe
 * lifecycle (probing spinner, backoff with its `next_attempt_at` countdown and
 * last-failure detail) and the login handoff when present. All read straight
 * off `authState`; nothing here is re-derived. Shows nothing extra when the
 * runtime has not filled those slots.
 */
export function HarnessAuthEvidenceSummary({
  authState,
  now = Date.now(),
  onRetryHandoff,
}: {
  authState: AgentAuthState;
  now?: number;
  onRetryHandoff?: () => void;
}) {
  const nextAction = labelForNextAction(authState.nextAction);
  const probe = authState.facts.probe;
  const handoff = authState.facts.handoff
    ? presentHandoff(authState.facts.handoff)
    : null;
  const countdown =
    probe.phase === "backoff" && probe.nextAttemptAt
      ? formatCountdown(probe.nextAttemptAt, now)
      : null;

  return (
    <div className="space-y-2 pb-1" data-harness-evidence-summary>
      {nextAction ? (
        <p className="text-ui-sm text-muted-foreground">
          <span className="text-foreground">Next:</span> {nextAction}
        </p>
      ) : null}

      {probe.phase === "running" || probe.phase === "queued" ? (
        <p
          className="flex items-center gap-2 text-ui-sm text-muted-foreground"
          data-harness-probe-phase={probe.phase}
        >
          <RefreshCw className="icon-paired animate-spin" />
          {probe.phase === "running" ? "Probing models…" : "Probe queued…"}
        </p>
      ) : null}

      {probe.phase === "backoff" ? (
        <p
          className="text-ui-sm text-muted-foreground"
          data-harness-probe-phase="backoff"
        >
          {countdown
            ? `Probe failed. Next attempt in ${countdown}.`
            : "Probe failed. Retrying shortly."}
          {probe.lastFailureDetail ? ` ${probe.lastFailureDetail}` : ""}
        </p>
      ) : null}

      {handoff ? (
        <p
          className="flex items-center gap-2 text-ui-sm text-muted-foreground"
          data-harness-handoff={authState.facts.handoff ?? undefined}
        >
          {handoff.inFlight ? (
            <RefreshCw className="icon-paired animate-spin" />
          ) : null}
          {handoff.label}
          {handoff.retryable && onRetryHandoff ? (
            <button
              type="button"
              className="text-foreground underline underline-offset-2"
              onClick={onRetryHandoff}
            >
              Retry
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
