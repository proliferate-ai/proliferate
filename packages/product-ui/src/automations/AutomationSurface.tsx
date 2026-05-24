import { CalendarClock, List, Plus, RotateCcw } from "lucide-react";
import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Button } from "@proliferate/ui/primitives/Button";
import type {
  AutomationCalendarDayView,
  AutomationInventoryGroupView,
  AutomationSurfaceViewMode,
} from "@proliferate/product-model/automations/inventory";
import { ProductPageShell } from "../layout/ProductPageShell";
import { AutomationCalendarView } from "./AutomationCalendarView";
import { AutomationInventoryList } from "./AutomationInventoryList";

export interface AutomationSurfaceProps {
  mode: AutomationSurfaceViewMode;
  groups: readonly AutomationInventoryGroupView[];
  calendarDays: readonly AutomationCalendarDayView[];
  includePaused: boolean;
  loading?: boolean;
  error?: boolean;
  actionError?: string | null;
  busyAutomationId?: string | null;
  busyAction?: "pause" | "resume" | "run" | null;
  actionsDisabled?: boolean;
  description?: ReactNode;
  maxWidthClassName?: string;
  onModeChange: (mode: AutomationSurfaceViewMode) => void;
  onIncludePausedChange: (includePaused: boolean) => void;
  onNew: () => void;
  onRetry?: () => void;
  onAutomationSelect: (automationId: string) => void;
  onEdit?: (automationId: string) => void;
  onPause: (automationId: string) => void;
  onResume: (automationId: string) => void;
  onRunNow: (automationId: string) => void;
}

export function AutomationSurface({
  mode,
  groups,
  calendarDays,
  includePaused,
  loading = false,
  error = false,
  actionError = null,
  busyAutomationId = null,
  busyAction = null,
  actionsDisabled = false,
  description = "Create scheduled work against local, personal cloud, and shared cloud targets.",
  maxWidthClassName = "max-w-none",
  onModeChange,
  onIncludePausedChange,
  onNew,
  onRetry,
  onAutomationSelect,
  onEdit,
  onPause,
  onResume,
  onRunNow,
}: AutomationSurfaceProps) {
  const itemCount = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <ProductPageShell
      title="Automations"
      description={description}
      actions={(
        <Button type="button" onClick={onNew}>
          <Plus className="size-4" aria-hidden />
          New automation
        </Button>
      )}
      maxWidthClassName={maxWidthClassName}
      telemetryBlocked
    >
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 pt-1">
        <ViewModeTabs mode={mode} onChange={onModeChange} />
        {mode === "calendar" ? (
          <IncludePausedSwitch
            checked={includePaused}
            onChange={onIncludePausedChange}
          />
        ) : null}
      </div>

      {actionError ? (
        <div className="rounded-[8px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      {loading ? (
        <div className="py-4 text-xs text-muted-foreground" role="status" aria-live="polite">
          Loading automations
        </div>
      ) : error ? (
        <EmptyState
          title="Could not load automations"
          description="Refresh the page or sign in again."
          action={onRetry ? (
            <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
              <RotateCcw size={13} aria-hidden />
              Retry
            </Button>
          ) : null}
        />
      ) : itemCount === 0 ? (
        <EmptyState
          title="No automations yet"
          description="Create a scheduled automation for a configured repo."
          action={(
            <Button type="button" size="sm" variant="secondary" onClick={onNew}>
              <Plus size={13} aria-hidden />
              New automation
            </Button>
          )}
        />
      ) : mode === "calendar" ? (
        <AutomationCalendarView
          days={calendarDays}
          onAutomationSelect={onAutomationSelect}
        />
      ) : (
        <AutomationInventoryList
          groups={groups}
          busyAutomationId={busyAutomationId}
          busyAction={busyAction}
          actionsDisabled={actionsDisabled}
          onAutomationSelect={onAutomationSelect}
          onEdit={onEdit}
          onPause={onPause}
          onResume={onResume}
          onRunNow={onRunNow}
        />
      )}
    </ProductPageShell>
  );
}

function ViewModeTabs({
  mode,
  onChange,
}: {
  mode: AutomationSurfaceViewMode;
  onChange: (mode: AutomationSurfaceViewMode) => void;
}) {
  const items: Array<{ id: AutomationSurfaceViewMode; label: string; icon: typeof List }> = [
    { id: "list", label: "List", icon: List },
    { id: "calendar", label: "Calendar", icon: CalendarClock },
  ];
  return (
    <div className="flex items-center gap-1 rounded-[8px] bg-foreground/[0.035] p-1">
      {items.map((item) => {
        const active = item.id === mode;
        const Icon = item.icon;
        return (
          <Button
            key={item.id}
            variant="unstyled"
            size="unstyled"
            type="button"
            onClick={() => onChange(item.id)}
            aria-pressed={active}
            className={twMerge(
              "flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-xs transition-colors",
              active
                ? "bg-foreground/[0.075] font-medium text-foreground"
                : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {item.label}
          </Button>
        );
      })}
    </div>
  );
}

function IncludePausedSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Button
      variant="unstyled"
      size="unstyled"
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 rounded-[6px] px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
    >
      <span>Include paused</span>
      <span
        className={twMerge(
          "relative inline-flex h-3.5 w-6 shrink-0 rounded-full p-0.5 transition-colors",
          checked ? "bg-foreground/[0.6]" : "bg-foreground/[0.18]",
        )}
        aria-hidden
      >
        <span
          className={twMerge(
            "size-2.5 rounded-full bg-background transition-transform",
            checked ? "translate-x-2.5" : "translate-x-0",
          )}
        />
      </span>
    </Button>
  );
}
