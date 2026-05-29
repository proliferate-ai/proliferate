import { Check, Lock, PlugZap, Shield } from "lucide-react";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { ProductNotice } from "../layout/ProductNotice";

export interface PluginAccessItemView {
  id: string;
  name: string;
  description: string;
  kind: string;
  visibility: string;
  enabled: boolean;
}

interface PluginAccessListProps {
  items: PluginAccessItemView[];
}

export function PluginAccessList({ items }: PluginAccessListProps) {
  return (
    <div className="grid gap-4">
      <ProductNotice
        tone="info"
        icon={<Shield size={16} />}
        title="Public credentials feed team sandboxes"
        description="Tools marked public are available to team automations, Slack sessions, and shared cloud workspaces."
      />
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((plugin) => (
          <article key={plugin.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-foreground">
                  <PlugZap size={16} />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{plugin.name}</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{plugin.description}</p>
                </div>
              </div>
              <Badge tone={plugin.enabled ? "success" : "neutral"} className="gap-1">
                {plugin.enabled ? <Check size={12} /> : <Lock size={12} />}
                {plugin.enabled ? "On" : "Off"}
              </Badge>
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
