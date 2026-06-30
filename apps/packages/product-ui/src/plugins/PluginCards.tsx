import type { ReactNode } from "react";
import type { PluginInventoryItem } from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { PluginGlyph } from "./PluginGlyph";
import { badgeTone } from "./plugin-presentation";
import type { PluginIconRenderer } from "./plugin-types";

export function PluginList({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border-light bg-surface-elevated">
      {children}
    </div>
  );
}

export function PluginRow({
  item,
  pending,
  renderIcon,
  onOpen,
  onConnect,
  onDisconnect,
  onOpenDesktop,
}: {
  item: PluginInventoryItem;
  pending: boolean;
  renderIcon?: PluginIconRenderer;
  onOpen: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenDesktop: () => void;
}) {
  const disabledOnSurface = Boolean(item.unavailableReason);
  const statusTone = badgeTone(item.statusTone);
  const icon = renderIcon?.(item, "md") ?? <PluginGlyph item={item} size="md" />;
  const showStatus = item.state === "installed" && (item.broken || !item.enabled);

  return (
    <article className="grid min-h-[5.5rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border-light px-4 py-4 last:border-b-0 sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center justify-start gap-4 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {icon}
          <span className="min-w-0 space-y-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 text-sm font-medium leading-5 text-foreground">
                {item.entry.name}
              </span>
              {showStatus ? (
                <Badge tone={statusTone} className="shrink-0">
                  {item.statusLabel}
                </Badge>
              ) : null}
            </span>
            <span className="line-clamp-2 max-w-3xl text-sm leading-5 text-muted-foreground">
              {item.entry.oneLiner}
            </span>
          </span>
        </Button>
      </div>

      <PluginRowAction
        item={item}
        pending={pending}
        disabledOnSurface={disabledOnSurface}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onOpenDesktop={onOpenDesktop}
      />
    </article>
  );
}

function PluginRowAction({
  item,
  pending,
  disabledOnSurface,
  onConnect,
  onDisconnect,
  onOpenDesktop,
}: {
  item: PluginInventoryItem;
  pending: boolean;
  disabledOnSurface: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenDesktop: () => void;
}) {
  if (item.state === "installed" && item.statusActionLabel) {
    return (
      <Button
        type="button"
        variant="inverted"
        size="sm"
        loading={pending}
        onClick={onConnect}
        className="h-9 min-w-24 rounded-md px-4 text-sm"
      >
        {item.statusActionLabel}
      </Button>
    );
  }

  if (item.state === "installed") {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={onDisconnect}
        className="h-9 min-w-24 rounded-md px-4 text-sm"
      >
        Disconnect
      </Button>
    );
  }

  if (disabledOnSurface) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onOpenDesktop}
        className="h-9 min-w-24 rounded-md px-4 text-sm"
      >
        Open Desktop
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="inverted"
      size="sm"
      loading={pending}
      onClick={onConnect}
      className="h-9 min-w-24 rounded-md px-4 text-sm"
    >
      Connect
    </Button>
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
