
import type { ReactNode } from "react";
import type { PluginInventoryItem } from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import { Plus } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { PluginGlyph } from "./PluginGlyph";
import { badgeTone } from "./plugin-presentation";
import type { PluginIconRenderer } from "./plugin-types";

export function PluginSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="border-b border-border/60 pb-2">
        <h2 className="text-xs font-medium uppercase text-muted-foreground">{title}</h2>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

export function PluginCard({
  item,
  pending,
  renderIcon,
  onOpen,
  onToggle,
  onConfigure,
  onOpenDesktop,
}: {
  item: PluginInventoryItem;
  pending: boolean;
  renderIcon?: PluginIconRenderer;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  onConfigure: () => void;
  onOpenDesktop: () => void;
}) {
  const disabledOnSurface = Boolean(item.unavailableReason);
  const statusTone = badgeTone(item.statusTone);
  const icon = renderIcon?.(item, "sm") ?? <PluginGlyph item={item} size="sm" />;

  return (
    <article className="group/plugin flex min-h-[96px] flex-col gap-2 rounded-lg border border-border/60 bg-foreground/5 p-3 transition-colors hover:bg-foreground/[0.075]">
      <div className="flex min-w-0 items-start gap-3">
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {icon}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{item.entry.name}</span>
              <Badge tone={statusTone} className="shrink-0">
                {item.statusLabel}
              </Badge>
            </span>
            <span className="line-clamp-1 text-xs leading-5 text-muted-foreground">
              {item.entry.oneLiner}
            </span>
          </span>
        </Button>
      </div>

      <div className="flex min-w-0 items-center gap-2 pl-11">
        <div className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
          {item.capabilitySummary}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item.state === "installed" ? (
            item.statusActionLabel ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={pending}
                onClick={onConfigure}
                className="h-7 px-2 text-[11px]"
              >
                {item.statusActionLabel}
              </Button>
            ) : (
              <Switch
                checked={item.enabled}
                disabled={pending}
                onChange={onToggle}
                size="compact"
                aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.entry.name}`}
              />
            )
          ) : disabledOnSurface ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenDesktop}
              className="h-7 px-2 text-[11px]"
            >
              Open Desktop
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon"
              loading={pending}
              onClick={onConfigure}
              className="size-7 shrink-0 rounded-md"
              aria-label={`Install ${item.entry.name}`}
              title={`Install ${item.entry.name}`}
            >
              <Plus className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

export function PluginListMessage({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-elevated-secondary px-4 py-8 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
