import type {
  SessionMcpBindingNotAppliedReason,
  SessionMcpBindingSummary,
} from "@anyharness/sdk";
import { useMemo } from "react";
import { useConnectors } from "@/hooks/mcp/use-connectors";
import type { InstalledConnectorRecord } from "@/lib/domain/mcp/types";

interface SessionPowersSummaryProps {
  summaries: SessionMcpBindingSummary[] | null;
}

const REASON_LABELS: Record<SessionMcpBindingNotAppliedReason, string> = {
  missing_secret: "missing secret",
  needs_reconnect: "needs reconnect",
  unsupported_target: "unsupported target",
  workspace_path_unresolved: "workspace path unavailable",
  policy_disabled: "policy disabled",
  resolver_error: "resolver error",
};

const NON_RESTARTABLE_REASONS: ReadonlySet<SessionMcpBindingNotAppliedReason> = new Set([
  "policy_disabled",
  "unsupported_target",
]);
const EMPTY_INSTALLED_CONNECTORS: InstalledConnectorRecord[] = [];

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

export function shouldShowPowersNeedsRestart(input: {
  connectorDataReady: boolean;
  installed: InstalledConnectorRecord[];
  summaries: SessionMcpBindingSummary[] | null;
}): boolean {
  if (!input.connectorDataReady || !input.summaries) {
    return false;
  }

  const appliedIds = new Set(
    input.summaries
      .filter((summary) => summary.outcome === "applied")
      .map((summary) => summary.id),
  );
  const notRestartableIds = new Set(
    input.summaries
      .filter((summary) => (
        summary.outcome === "not_applied"
        && !!summary.reason
        && NON_RESTARTABLE_REASONS.has(summary.reason)
      ))
      .map((summary) => summary.id),
  );
  const expectedIds = new Set(
    input.installed
      .filter((record) => (
        record.metadata.enabled
        && !record.broken
        && !notRestartableIds.has(record.metadata.connectionId)
      ))
      .map((record) => record.metadata.connectionId),
  );

  return !setsEqual(appliedIds, expectedIds);
}

export function SessionPowersSummary({ summaries }: SessionPowersSummaryProps) {
  const { data, isPlaceholderData } = useConnectors();
  const needsRestart = useMemo(() => {
    return shouldShowPowersNeedsRestart({
      connectorDataReady: !isPlaceholderData,
      installed: data?.installed ?? EMPTY_INSTALLED_CONNECTORS,
      summaries,
    });
  }, [data?.installed, isPlaceholderData, summaries]);

  if (!summaries || (summaries.length === 0 && !needsRestart)) {
    return null;
  }

  const applied = summaries.filter((summary) => summary.outcome === "applied");
  const notApplied = summaries.filter((summary) => summary.outcome === "not_applied");
  const title = summaries.length > 0
    ? summaries
      .map((summary) => {
        const name = summary.displayName || summary.serverName;
        const reason = summary.reason ? ` (${REASON_LABELS[summary.reason] ?? summary.reason})` : "";
        return `${name}: ${summary.outcome === "applied" ? "applied" : "not applied"}${reason}`;
      })
      .join("\n")
    : "No Powers were applied to this session.";

  return (
    <div
      className="flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-muted/25 px-2 py-1 text-xs text-muted-foreground"
      title={title}
    >
      <span className="font-medium text-foreground">Powers</span>
      {applied.length > 0 && (
        <span className="rounded-sm bg-foreground/5 px-1.5 py-0.5 text-foreground">
          Applied to this session: {applied.length}
        </span>
      )}
      {summaries.length === 0 && (
        <span className="rounded-sm bg-foreground/5 px-1.5 py-0.5 text-foreground">
          None applied
        </span>
      )}
      {notApplied.length > 0 && (
        <span className="rounded-sm bg-warning/10 px-1.5 py-0.5 text-warning-foreground">
          Not applied: {notApplied.length}
        </span>
      )}
      {needsRestart && (
        <span className="rounded-sm border border-warning-border bg-warning px-1.5 py-0.5 text-warning-foreground">
          Needs restart
        </span>
      )}
    </div>
  );
}
