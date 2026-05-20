import { CalendarClock, Plus } from "lucide-react";
import { useAutomations } from "@proliferate/cloud-sdk-react";

import { Button } from "@proliferate/ui/primitives/Button";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { ListSurface } from "@proliferate/ui/layout/ListSurface";

export function AutomationsScreen() {
  const automations = useAutomations();

  return (
    <div className="web-scrollbar h-full overflow-y-auto" data-telemetry-block>
      <div className="mx-auto w-full max-w-3xl px-8 py-10">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Automations</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Scheduled cloud work. More automation kinds run on Desktop.
            </p>
          </div>
          <Button size="sm" variant="secondary">
            <Plus size={13} />
            New
          </Button>
        </header>

        {automations.isLoading ? (
          <ListSurface>
            <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
              Loading automations…
            </div>
          </ListSurface>
        ) : automations.error ? (
          <EmptyState
            title="Could not load automations"
            description="Refresh the page or sign in again."
          />
        ) : automations.data?.automations.length ? (
          <ListSurface>
            {automations.data.automations.map((automation, index) => (
              <AutomationRow
                key={automation.id}
                title={automation.title}
                repo={`${automation.gitOwner}/${automation.gitRepoName}`}
                schedule={automation.schedule.summary}
                target={automation.executionTarget}
                lastRun={automation.lastScheduledAt}
                enabled={automation.enabled}
                isLast={index === automations.data.automations.length - 1}
              />
            ))}
          </ListSurface>
        ) : (
          <EmptyState
            title="No automations yet"
            description="Create automations from Desktop while this surface is being wired."
          />
        )}
      </div>
    </div>
  );
}

interface AutomationRowProps {
  title: string;
  repo: string;
  schedule: string;
  target: string;
  lastRun: string | null | undefined;
  enabled: boolean;
  isLast: boolean;
}

function AutomationRow({
  title,
  repo,
  schedule,
  target,
  lastRun,
  enabled,
  isLast,
}: AutomationRowProps) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      className={`group flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-accent ${
        isLast ? "" : "border-b border-border-light"
      }`}
    >
      <span className="flex size-2 shrink-0 items-center justify-center">
        <span
          className={`size-2 rounded-full ${
            enabled ? "bg-success" : "bg-muted-foreground/40"
          }`}
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-foreground">
          {title}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground">
          <CalendarClock size={11.5} className="shrink-0" />
          <span className="truncate">{schedule}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="truncate">{repo}</span>
        </span>
      </span>

      <span className="hidden min-w-0 max-w-[180px] shrink-0 truncate text-right text-[11.5px] text-muted-foreground md:block">
        <span className="block truncate">{target}</span>
        <span className="block truncate text-muted-foreground/60">
          {lastRun ? `Ran ${lastRun}` : "Not scheduled yet"}
        </span>
      </span>

      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium tracking-wide ${
          enabled
            ? "bg-success-subtle text-success"
            : "bg-accent text-muted-foreground"
        }`}
      >
        {enabled ? "On" : "Paused"}
      </span>
    </Button>
  );
}
