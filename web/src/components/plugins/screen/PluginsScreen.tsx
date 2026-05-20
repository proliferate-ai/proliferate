import { Check, Lock, PlugZap, Shield, SlidersHorizontal } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";

import { plugins } from "../../../lib/fixtures/web-fixtures";

export function PluginsScreen() {
  return (
    <div className="web-scrollbar h-full overflow-y-auto px-8 py-8" data-telemetry-block>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Plugins and MCPs</p>
          <h1 className="mt-2 text-2xl font-semibold">Shared sandbox access</h1>
        </div>
        <Button variant="secondary" size="md">
          <SlidersHorizontal size={15} />
          Configure
        </Button>
      </header>

      <div className="mb-4 rounded-lg border border-info/40 bg-info/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Shield size={16} />
          Public credentials feed team sandboxes
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Tools marked public are available to team automations, Slack sessions, and shared cloud workspaces.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {plugins.map((plugin) => (
          <article key={plugin.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-foreground">
                  <PlugZap size={16} />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{plugin.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{plugin.description}</p>
                </div>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  plugin.enabled
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                {plugin.enabled ? <Check size={12} /> : <Lock size={12} />}
                {plugin.enabled ? "On" : "Off"}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-border px-2 py-1">{plugin.kind}</span>
              <span className="rounded-md border border-border px-2 py-1">{plugin.visibility}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
