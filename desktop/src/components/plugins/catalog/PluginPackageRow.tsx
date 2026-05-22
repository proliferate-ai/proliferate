import type { ReactNode } from "react";
import type {
  AvailableCardModel,
  ConnectedCardModel,
} from "@/lib/domain/mcp/connector-catalog-view-model";
import type { PluginPackagePresentation } from "@/lib/domain/plugins/plugin-package-view-model";
import {
  buildAvailablePluginPresentation,
  buildConnectedPluginPresentation,
  buildPluginSharedExposurePresentation,
  type PluginSharedExposurePresentation,
} from "@/lib/domain/plugins/plugin-package-view-model";
import { Button } from "@proliferate/ui/primitives/Button";
import { Switch } from "@/components/ui/Switch";
import { ConnectorIcon } from "@/components/plugins/status/ConnectorIcon";
import { ConnectorOverflowMenu } from "@/components/plugins/status/ConnectorOverflowMenu";
import { ConnectorStatusChip } from "@/components/plugins/status/ConnectorStatusChip";
import { Globe, Plus } from "@/components/ui/icons";

const SHARED_EXPOSURE_TONE_CLASSES: Record<PluginSharedExposurePresentation["sharedCloudTone"], string> = {
  neutral: "border-border/50 bg-muted/20 text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  muted: "border-border/50 bg-muted/30 text-muted-foreground",
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
  onSetSharedExposure,
  onStatusClick,
  onToggle,
  pending,
  canManageSharedExposure,
  organizationId,
}: {
  model: ConnectedCardModel;
  onDelete: () => void;
  onManage: () => void;
  onReconnect?: () => void;
  onSetSharedExposure: (publicToOrg: boolean) => void;
  onStatusClick: () => void;
  onToggle: (enabled: boolean) => void;
  pending: boolean;
  canManageSharedExposure: boolean;
  organizationId: string | null;
}) {
  const presentation = buildConnectedPluginPresentation(model.record, model.status);
  const exposure = buildPluginSharedExposurePresentation(model.record);
  const enabled = model.record.metadata.enabled;
  const nextPublicToOrg = !exposure.isFullyPublic;
  const canShowSharedAction =
    canManageSharedExposure
    && Boolean(organizationId)
    && exposure.configuredItemCount > 0
    && model.record.metadata.ownerScope !== "organization";

  return (
    <PluginPackageCard
      icon={<ConnectorIcon entry={model.record.catalogEntry} size="md" />}
      presentation={presentation}
      sharedExposure={exposure}
      onOpen={model.status.actionable ? onStatusClick : onManage}
      status={<ConnectorStatusChip status={model.status} onClick={onStatusClick} />}
      controls={(
        <div className="flex shrink-0 items-center gap-1">
          {canShowSharedAction && (
            <Button
              type="button"
              variant={exposure.isFullyPublic ? "ghost" : "outline"}
              size="sm"
              loading={pending}
              onClick={() => onSetSharedExposure(nextPublicToOrg)}
              title={nextPublicToOrg
                ? "Make configured MCP, plugin, and skill items public to shared cloud."
                : "Make configured MCP, plugin, and skill items private to personal cloud."}
              className="h-7 px-2"
            >
              <Globe className="size-3.5" />
              {nextPublicToOrg ? "Make public" : "Make private"}
            </Button>
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
  sharedExposure,
  status,
}: {
  controls: ReactNode;
  icon: ReactNode;
  onOpen: () => void;
  presentation: PluginPackagePresentation;
  sharedExposure?: PluginSharedExposurePresentation;
  status?: ReactNode;
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
            <div className="line-clamp-1 text-xs text-muted-foreground/80">
              {presentation.includesLabel}
            </div>
            {sharedExposure && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-border/50 bg-muted/20 px-2 py-0.5 text-[11px] text-muted-foreground">
                  {sharedExposure.personalCloudLabel}
                </span>
                <span className="rounded-full border border-border/50 bg-muted/20 px-2 py-0.5 text-[11px] text-muted-foreground">
                  {sharedExposure.sourceLabel}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${SHARED_EXPOSURE_TONE_CLASSES[sharedExposure.sharedCloudTone]}`}
                  title={sharedExposure.sharedCloudDescription}
                >
                  {sharedExposure.sharedCloudLabel}
                </span>
              </div>
            )}
          </div>
        </Button>
        {status && (
          <div className="shrink-0">
            {status}
          </div>
        )}
        <div className="flex shrink-0 items-center">
          {controls}
        </div>
      </div>
    </div>
  );
}
