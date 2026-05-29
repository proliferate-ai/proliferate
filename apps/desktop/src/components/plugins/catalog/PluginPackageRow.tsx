import type { ReactNode } from "react";
import type {
  AvailableCardModel,
  ConnectedCardModel,
} from "@/lib/domain/mcp/connector-catalog-view-model";
import type { PluginPackagePresentation } from "@/lib/domain/plugins/plugin-package-view-model";
import {
  buildAvailablePluginPresentation,
  buildConnectedPluginPresentation,
} from "@/lib/domain/plugins/plugin-package-view-model";
import { Button } from "@proliferate/ui/primitives/Button";
import { Switch } from "@/components/ui/Switch";
import { ConnectorIcon } from "@/components/plugins/status/ConnectorIcon";
import { ConnectorOverflowMenu } from "@/components/plugins/status/ConnectorOverflowMenu";
import { Plus } from "@/components/ui/icons";

const STATUS_TONE_CLASSES: Record<PluginPackagePresentation["statusTone"], string> = {
  neutral: "border-border/50 bg-muted/30 text-muted-foreground",
  muted: "border-border/40 bg-muted/20 text-muted-foreground/80",
  warning: "border-warning/30 bg-warning/10 text-warning",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function AvailablePluginPackageRow({
  model,
  onConnect,
}: {
  model: AvailableCardModel;
  onConnect: () => void;
}) {
  const presentation = buildAvailablePluginPresentation(model.entry);

  return (
    <PluginPackageCard
      icon={<ConnectorIcon entry={model.entry} size="sm" />}
      presentation={presentation}
      onOpen={onConnect}
      trailing={(
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={(event) => {
            event.stopPropagation();
            onConnect();
          }}
          aria-label={`Install ${presentation.name}`}
          title={`Install ${presentation.name}`}
          className="size-7 shrink-0 rounded-md"
        >
          <Plus className="size-3.5" />
        </Button>
      )}
    />
  );
}

export function ConnectedPluginPackageRow({
  model,
  onDelete,
  onManage,
  onReconnect,
  onStatusClick,
  onToggle,
  pending,
}: {
  model: ConnectedCardModel;
  onDelete: () => void;
  onManage: () => void;
  onReconnect?: () => void;
  onStatusClick: () => void;
  onToggle: (enabled: boolean) => void;
  pending: boolean;
}) {
  const presentation = buildConnectedPluginPresentation(model.record, model.status);
  const enabled = model.record.metadata.enabled;

  return (
    <PluginPackageCard
      icon={<ConnectorIcon entry={model.record.catalogEntry} size="sm" />}
      presentation={presentation}
      onOpen={model.status.actionable ? onStatusClick : onManage}
      trailing={(
        <>
          {presentation.recoveryActionLabel ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={pending}
              onClick={(event) => {
                event.stopPropagation();
                onStatusClick();
              }}
              className="h-7 px-2 text-[11px]"
            >
              {presentation.recoveryActionLabel}
            </Button>
          ) : (
            <Switch
              checked={enabled}
              disabled={pending}
              onChange={onToggle}
              size="compact"
              aria-label={`${enabled ? "Disable" : "Enable"} ${presentation.name}`}
            />
          )}
          <div className="pointer-events-none opacity-0 transition-opacity group-hover/plugin-package:pointer-events-auto group-hover/plugin-package:opacity-100 group-focus-within/plugin-package:pointer-events-auto group-focus-within/plugin-package:opacity-100">
            <ConnectorOverflowMenu
              disabled={pending}
              onDelete={onDelete}
              onManage={onManage}
              onReconnect={onReconnect}
              onToggle={onToggle}
              record={model.record}
            />
          </div>
        </>
      )}
    />
  );
}

function PluginPackageCard({
  icon,
  onOpen,
  presentation,
  trailing,
}: {
  icon: ReactNode;
  onOpen: () => void;
  presentation: PluginPackagePresentation;
  trailing: ReactNode;
}) {
  return (
    <article className="group/plugin-package flex min-h-[96px] flex-col gap-2 rounded-lg border border-border/60 bg-foreground/5 p-3 transition-colors hover:bg-foreground/[0.075]">
      <div className="flex min-w-0 items-start gap-3">
        <Button
          variant="unstyled"
          size="unstyled"
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {icon}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2 pr-1">
              <div className="truncate text-sm font-medium text-foreground">
                {presentation.name}
              </div>
              <PluginStatusPill presentation={presentation} />
            </div>
            <div className="line-clamp-1 text-xs leading-5 text-muted-foreground">
              {presentation.description}
            </div>
          </div>
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-2 pl-11">
        <div className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
          {presentation.capabilitySummary}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {trailing}
        </div>
      </div>
    </article>
  );
}

function PluginStatusPill({
  presentation,
}: {
  presentation: PluginPackagePresentation;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE_CLASSES[presentation.statusTone]}`}
    >
      {presentation.statusLabel}
    </span>
  );
}
