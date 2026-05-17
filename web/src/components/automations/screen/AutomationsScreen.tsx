import { Bot, CalendarClock, Cloud, Play, Plus } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";

import { automations } from "../../../lib/fixtures/web-fixtures";

export function AutomationsScreen() {
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

      <div className="grid gap-3">
        {automations.map((automation) => (
          <article key={automation.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-md bg-accent text-foreground">
                    <Bot size={15} />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold">{automation.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {automation.owner === "team" ? "Team automation" : "Personal automation"}
                    </p>
                  </div>
                </div>
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  automation.status === "enabled"
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                {automation.status}
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-border-light bg-background p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                  <CalendarClock size={14} />
                  Schedule
                </div>
                <p className="text-xs text-muted-foreground">{automation.scheduleLabel}</p>
              </div>
              <div className="rounded-md border border-border-light bg-background p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                  <Cloud size={14} />
                  Target
                </div>
                <p className="text-xs text-muted-foreground">{automation.targetLabel}</p>
              </div>
              <div className="rounded-md border border-border-light bg-background p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                  <Play size={14} />
                  Last run
                </div>
                <p className="text-xs text-muted-foreground">{automation.lastRunLabel}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
