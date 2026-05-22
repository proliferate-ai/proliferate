import { CalendarClock, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { ListSurface } from "@proliferate/ui/layout/ListSurface";
import { Button } from "@proliferate/ui/primitives/Button";
import { AutomationRow } from "./AutomationRow";

export interface AutomationListItemView {
  id: string;
  title: string;
  repo: string;
  schedule: string;
  target: string;
  lastRun?: string | null;
  nextRun?: string | null;
  ownerLabel?: string | null;
  enabled: boolean;
}

interface AutomationsListProps {
  items: AutomationListItemView[];
  loading?: boolean;
  error?: boolean;
  onNew?: () => void;
  onRetry?: () => void;
  onPause?: (automationId: string) => void;
  onResume?: (automationId: string) => void;
  onRunNow?: (automationId: string) => void;
  busyAutomationId?: string | null;
  busyAction?: "pause" | "resume" | "run" | null;
}

export function AutomationsList({
  items,
  loading = false,
  error = false,
  onNew,
  onRetry,
  onPause,
  onResume,
  onRunNow,
  busyAutomationId = null,
  busyAction = null,
}: AutomationsListProps) {
  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={onNew}>
          <Plus size={13} />
          New
        </Button>
      </div>
      {loading ? (
        <ListSurface>
          <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
            Loading automations...
          </div>
        </ListSurface>
      ) : error ? (
        <EmptyState
          title="Could not load automations"
          description="Refresh the page or sign in again."
          action={onRetry ? (
            <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
              <RotateCcw size={13} />
              Retry
            </Button>
          ) : null}
        />
      ) : items.length > 0 ? (
        <ListSurface>
          {items.map((automation) => (
            <AutomationRow
              key={automation.id}
              name={automation.title}
              description={(
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <CalendarClock size={11.5} className="shrink-0" />
                  <span className="truncate">{automation.schedule}</span>
                  <span className="text-muted-foreground/40">-</span>
                  <span className="truncate">{automation.repo}</span>
                  <span className="text-muted-foreground/40">-</span>
                  <span className="truncate">{automation.target}</span>
                  {automation.ownerLabel ? (
                    <>
                      <span className="text-muted-foreground/40">-</span>
                      <span className="truncate">{automation.ownerLabel}</span>
                    </>
                  ) : null}
                </span>
              )}
              runSummary={automation.lastRun
                ? `Last ${automation.lastRun}`
                : automation.nextRun
                  ? `Next ${automation.nextRun}`
                  : "Not scheduled yet"}
              statusLabel={automation.enabled ? "On" : "Paused"}
              statusTone={automation.enabled ? "success" : "neutral"}
              actions={(
                <AutomationRowActions
                  automation={automation}
                  busy={busyAutomationId === automation.id ? busyAction : null}
                  onPause={onPause}
                  onResume={onResume}
                  onRunNow={onRunNow}
                />
              )}
            />
          ))}
        </ListSurface>
      ) : (
        <EmptyState
          title="No automations yet"
          description="Create a scheduled cloud automation for a configured repo."
          action={onNew ? (
            <Button type="button" size="sm" variant="secondary" onClick={onNew}>
              <Plus size={13} />
              New automation
            </Button>
          ) : null}
        />
      )}
    </>
  );
}

function AutomationRowActions({
  automation,
  busy,
  onPause,
  onResume,
  onRunNow,
}: {
  automation: AutomationListItemView;
  busy: "pause" | "resume" | "run" | null;
  onPause?: (automationId: string) => void;
  onResume?: (automationId: string) => void;
  onRunNow?: (automationId: string) => void;
}) {
  if (!onPause && !onResume && !onRunNow) {
    return null;
  }

  return (
    <span className="flex items-center gap-1">
      {onRunNow ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          loading={busy === "run"}
          disabled={busy !== null && busy !== "run"}
          onClick={() => onRunNow(automation.id)}
        >
          {busy !== "run" ? <Play size={12} /> : null}
          Run
        </Button>
      ) : null}
      {automation.enabled ? (
        onPause ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={busy === "pause"}
            disabled={busy !== null && busy !== "pause"}
            onClick={() => onPause(automation.id)}
          >
            {busy !== "pause" ? <Pause size={12} /> : null}
            Pause
          </Button>
        ) : null
      ) : onResume ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          loading={busy === "resume"}
          disabled={busy !== null && busy !== "resume"}
          onClick={() => onResume(automation.id)}
        >
          {busy !== "resume" ? <RotateCcw size={12} /> : null}
          Resume
        </Button>
      ) : null}
    </span>
  );
}
