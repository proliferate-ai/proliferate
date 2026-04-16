import type { SessionMcpBindingSummary } from "@anyharness/sdk";
import { useMemo } from "react";
import { useConnectors } from "@/hooks/mcp/use-connectors";

interface SessionPowersSummaryProps {
  summaries: SessionMcpBindingSummary[] | null;
}

const REASON_LABELS: Record<string, string> = {
  missing_secret: "missing secret",
  needs_reconnect: "needs reconnect",
  unsupported_target: "unsupported target",
  workspace_path_unresolved: "workspace path unavailable",
  policy_disabled: "policy disabled",
  resolver_error: "resolver error",
};

export function SessionPowersSummary({ summaries }: SessionPowersSummaryProps) {
  const { data } = useConnectors();
  const needsRestart = useMemo(() => {
    if (!summaries || summaries.length === 0) {
      return false;
    }

    const appliedIds = new Set(
      summaries
        .filter((summary) => summary.outcome === "applied")
        .map((summary) => summary.id),
    );
    const enabledIds = new Set(
      (data?.installed ?? [])
        .filter((record) => record.metadata.enabled && !record.broken)
        .map((record) => record.metadata.connectionId),
    );

    if (appliedIds.size !== enabledIds.size) {
      return true;
    }
    for (const id of enabledIds) {
      if (!appliedIds.has(id)) {
        return true;
      }
    }
    return false;
  }, [data?.installed, summaries]);

  if (!summaries || summaries.length === 0) {
    return null;
  }

  const applied = summaries.filter((summary) => summary.outcome === "applied");
  const notApplied = summaries.filter((summary) => summary.outcome === "not_applied");
  const title = summaries
    .map((summary) => {
      const name = summary.displayName || summary.serverName;
      const reason = summary.reason ? ` (${REASON_LABELS[summary.reason] ?? summary.reason})` : "";
      return `${name}: ${summary.outcome === "applied" ? "applied" : "not applied"}${reason}`;
    })
    .join("\n");

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
