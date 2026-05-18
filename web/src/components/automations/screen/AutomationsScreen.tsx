import { Bot, CalendarClock, Cloud, Play, Plus } from "lucide-react";
import { useAutomations } from "@proliferate/cloud-sdk-react";

import { Button } from "@proliferate/ui/primitives/Button";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";

export function AutomationsScreen() {
  const automations = useAutomations();

  return (
    <div className="web-scrollbar h-full overflow-y-auto px-8 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Automations</p>
          <h1 className="mt-2 text-2xl font-semibold">Scheduled cloud work</h1>
        </div>
        <Button size="md">
          <Plus size={15} />
          New automation
        </Button>
      </header>

      {automations.isLoading ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Loading automations
        </div>
      ) : automations.error ? (
        <EmptyState
          title="Could not load automations"
          description="Refresh the page or sign in again."
        />
      ) : automations.data?.automations.length ? (
        <div className="grid gap-3">
          {automations.data.automations.map((automation) => (
            <article key={automation.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-md bg-accent text-foreground">
                    <Bot size={15} />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold">{automation.title}</h2>
                    <p className="text-xs text-muted-foreground">
                      {automation.gitOwner}/{automation.gitRepoName}
                    </p>
                  </div>
                </div>
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  automation.enabled
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                {automation.enabled ? "enabled" : "paused"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-border-light bg-background p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                  <CalendarClock size={14} />
                  Schedule
                </div>
                <p className="text-xs text-muted-foreground">{automation.schedule.summary}</p>
              </div>
              <div className="rounded-md border border-border-light bg-background p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                  <Cloud size={14} />
                  Target
                </div>
                <p className="text-xs text-muted-foreground">{automation.executionTarget}</p>
              </div>
              <div className="rounded-md border border-border-light bg-background p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                  <Play size={14} />
                  Last run
                </div>
                <p className="text-xs text-muted-foreground">
                  {automation.lastScheduledAt ?? "Not scheduled yet"}
                </p>
              </div>
            </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No automations"
          description="Create automations from Desktop while this surface is being wired."
        />
      )}
    </div>
  );
}
