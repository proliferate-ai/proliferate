import type { AutomationRunResponse } from "@/lib/integrations/cloud/client";
import {
  automationRunStatusLabel,
  automationRunTimestampLabel,
} from "@/lib/domain/automations/view-model";

interface AutomationRunTimelineProps {
  runs: AutomationRunResponse[];
  loading: boolean;
}

export function AutomationRunTimeline({ runs, loading }: AutomationRunTimelineProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-foreground/5 p-4 text-sm text-muted-foreground">
        Loading runs...
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-foreground/5 p-4 text-sm text-muted-foreground">
        No runs queued yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {runs.map((run) => (
        <div
          key={run.id}
          className="rounded-lg border border-border bg-foreground/5 p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {automationRunStatusLabel(run)}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {automationRunTimestampLabel(run)}
              </p>
            </div>
            <span className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
              {run.triggerKind}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
