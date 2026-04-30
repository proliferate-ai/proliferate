import { Button } from "@/components/ui/Button";
import { ArrowLeft } from "@/components/ui/icons";
import type {
  AutomationResponse,
  AutomationRunResponse,
} from "@/lib/integrations/cloud/client";
import { buildAutomationRowViewModel } from "@/lib/domain/automations/view-model";
import { AutomationRunTimeline } from "./AutomationRunTimeline";

interface AutomationDetailContentProps {
  automation: AutomationResponse | null;
  loading: boolean;
  error: boolean;
  runs: AutomationRunResponse[];
  runsLoading: boolean;
  busy: boolean;
  onBack: () => void;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onRunNow: () => void;
}

export function AutomationDetailContent({
  automation,
  loading,
  error,
  runs,
  runsLoading,
  busy,
  onBack,
  onEdit,
  onPause,
  onResume,
  onRunNow,
}: AutomationDetailContentProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-foreground/5 p-5 text-sm text-muted-foreground">
        Loading automation...
      </div>
    );
  }

  if (error || !automation) {
    return (
      <div className="rounded-lg border border-border bg-foreground/5 p-5">
        <p className="text-sm font-medium text-foreground">Automation not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          It may have been deleted or you may not have access to it.
        </p>
        <Button variant="ghost" size="sm" onClick={onBack} className="mt-4">
          <ArrowLeft className="size-4" />
          Back to automations
        </Button>
      </div>
    );
  }

  const view = buildAutomationRowViewModel(automation);

  return (
    <div className="min-w-0 space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="w-fit">
        <ArrowLeft className="size-4" />
        Automations
      </Button>

      <div className="rounded-lg border border-border bg-foreground/5 p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-foreground">
                {view.title}
              </h2>
              <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {view.statusLabel}
              </span>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {view.repoLabel}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {view.scheduleLabel} - Next: {view.nextRunLabel} - {view.executionLabel}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRunNow}
              disabled={busy || !automation.enabled}
              title={automation.enabled ? "Queue a manual run" : "Resume before queueing a run"}
            >
              Run now
            </Button>
            <Button variant="ghost" size="sm" onClick={onEdit} disabled={busy}>
              Edit
            </Button>
            {automation.enabled ? (
              <Button variant="ghost" size="sm" onClick={onPause} disabled={busy}>
                Pause
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onResume} disabled={busy}>
                Resume
              </Button>
            )}
          </div>
        </div>
      </div>

      <section className="min-w-0">
        <div className="mb-3">
          <h3 className="text-sm font-medium text-foreground">Run history</h3>
          <p className="text-xs text-muted-foreground">
            Queued runs for this automation. Runs stay queued until an executor is available.
          </p>
        </div>
        <AutomationRunTimeline runs={runs} loading={runsLoading} />
      </section>
    </div>
  );
}
