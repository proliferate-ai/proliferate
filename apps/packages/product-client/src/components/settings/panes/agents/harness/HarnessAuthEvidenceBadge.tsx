import { RefreshCw } from "#product/primitives/icons/platform";
import { Badge } from "#product/primitives/Badge";
import { IconButton } from "#product/primitives/IconButton";
import type { HarnessStatus } from "#product/hooks/access/anyharness/agent-auth/use-harness-status";
import {
  statusEvidenceLine,
  statusLabel,
  statusRecheckingMarker,
  statusTone,
} from "#product/lib/domain/settings/agent-auth-status-presentation";

/**
 * The pane's ONE auth badge, rendering the runtime's status document VERBATIM
 * (agent_auth spec §4 cell 4).
 *
 * There is no local fallback and no readiness-based green: the label and tone
 * come from the document's `probe`/`applied`, green carries its evidence age
 * ("verified 2m ago"), a stale document keeps its LAST OBSERVATION on screen
 * with the ruled stale marker ("last checked 2m ago — retrying", founder-ruled
 * 2026-08-27 — never a spinner, never "loading", never a countdown), and a
 * harness the runtime holds no document for reads neutrally and gates nothing.
 */
export function HarnessAuthEvidenceBadge({
  status,
  refreshing,
  onRefresh,
  "data-harness-status": dataHarnessStatus,
}: {
  status: HarnessStatus;
  refreshing: boolean;
  onRefresh: () => void;
  "data-harness-status"?: string;
}) {
  // The wall clock, not an injected one: the evidence age is read at render, and
  // a `now` prop that only a test ever passed was shipped surface with no
  // production caller (its suite pins `Date.now` instead).
  const evidenceLine = statusEvidenceLine(status);
  const rechecking = statusRecheckingMarker(status);
  return (
    <>
      <Badge
        tone={statusTone(status)}
        data-harness-status={dataHarnessStatus}
        data-harness-probe-verdict={status.probe?.verdict ?? "unknown"}
        data-harness-probe-stale={status.probe?.stale ? "true" : "false"}
      >
        <span
          aria-hidden
          className="icon-status mr-1.5 inline-block shrink-0 rounded-full bg-current"
        />
        {statusLabel(status)}
        {evidenceLine ? (
          <span className="ml-1.5 font-normal opacity-70" data-harness-evidence-age>
            {evidenceLine}
          </span>
        ) : null}
        {rechecking ? (
          // The dimmed light: the observation above is the last one held, and a
          // re-probe is running. Rendered beside it, never instead of it.
          <span className="ml-1.5 font-normal opacity-60" data-harness-rechecking>
            {rechecking}
          </span>
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
