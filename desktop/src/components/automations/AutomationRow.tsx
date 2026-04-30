import { Button } from "@/components/ui/Button";
import type { AutomationResponse } from "@/lib/integrations/cloud/client";
import { buildAutomationRowViewModel } from "@/lib/domain/automations/view-model";

interface AutomationRowProps {
  automation: AutomationResponse;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onRunNow: () => void;
}

export function AutomationRow({
  automation,
  selected,
  busy,
  onSelect,
  onEdit,
  onPause,
  onResume,
  onRunNow,
}: AutomationRowProps) {
  const view = buildAutomationRowViewModel(automation);

  return (
    <div
      className={`group rounded-lg border p-3 transition-colors ${
        selected
          ? "border-foreground/25 bg-foreground/10"
          : "border-border bg-foreground/5 hover:bg-foreground/10"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelect}
          className="h-auto min-w-0 flex-1 justify-start rounded-md px-1 py-1 text-left hover:bg-transparent"
        >
          <span className="block min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{view.title}</span>
              <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {view.statusLabel}
              </span>
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {view.repoLabel}
            </span>
            <span className="mt-2 block truncate text-xs text-muted-foreground">
              {view.scheduleLabel} - Next: {view.nextRunLabel} - {view.executionLabel}
            </span>
          </span>
        </Button>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
  );
}
