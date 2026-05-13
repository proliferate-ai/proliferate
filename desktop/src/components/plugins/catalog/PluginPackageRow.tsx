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
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { ConnectorIcon } from "@/components/plugins/status/ConnectorIcon";
import { ConnectorOverflowMenu } from "@/components/plugins/status/ConnectorOverflowMenu";
import { Plus } from "@/components/ui/icons";

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
      icon={<ConnectorIcon entry={model.entry} size="md" />}
      presentation={presentation}
      onOpen={onConnect}
      controls={(
        <Button
          variant="ghost"
          size="icon"
          onClick={onConnect}
          aria-label={`Install ${presentation.name}`}
          title={`Install ${presentation.name}`}
          className="h-7 w-7 shrink-0 rounded-full bg-foreground/5 p-0.5 text-foreground hover:bg-foreground/10"
        >
          <Plus className="size-4" />
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
      icon={<ConnectorIcon entry={model.record.catalogEntry} size="md" />}
      presentation={presentation}
      onOpen={model.status.actionable ? onStatusClick : onManage}
      controls={(
        <div className="flex shrink-0 items-center gap-1">
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
          <Switch
            checked={enabled}
            disabled={pending}
            onChange={onToggle}
            size="compact"
            aria-label={`${enabled ? "Disable" : "Enable"} ${presentation.name}`}
          />
        </div>
      )}
    />
  );
}

function PluginPackageCard({
  controls,
  icon,
  onOpen,
  presentation,
}: {
  controls: ReactNode;
  icon: ReactNode;
  onOpen: () => void;
  presentation: PluginPackagePresentation;
}) {
  return (
    <div className="group/plugin-package flex min-h-[60px] flex-col justify-center gap-2.5 rounded-2xl border border-transparent p-2.5 transition-colors hover:bg-foreground/5">
      <div className="flex items-center gap-3">
        <Button
          variant="unstyled"
          size="unstyled"
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {icon}
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate text-sm font-medium text-foreground">
                {presentation.name}
              </div>
            </div>
            <div className="line-clamp-1 text-sm leading-relaxed text-muted-foreground">
              {presentation.description}
            </div>
          </div>
        </Button>
        <div className="flex shrink-0 items-center">
          {controls}
        </div>
      </div>
    </div>
  );
}
