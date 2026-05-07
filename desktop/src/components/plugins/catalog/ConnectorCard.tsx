import type {
  AvailableCardModel,
  ConnectedCardModel,
} from "@/hooks/mcp/use-connectors-catalog-state";
import { ConnectorIcon } from "@/components/plugins/status/ConnectorIcon";
import { ConnectorOverflowMenu } from "@/components/plugins/status/ConnectorOverflowMenu";
import { ConnectorStatusChip } from "@/components/plugins/status/ConnectorStatusChip";

const CARD_BASE =
  "group flex h-full min-h-[132px] flex-col items-start rounded-2xl border border-border bg-card p-4 text-left transition-colors";

export function AvailableConnectorCard({
  model,
  onConnect,
}: {
  model: AvailableCardModel;
  onConnect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onConnect}
      className={`${CARD_BASE} cursor-pointer hover:border-border hover:bg-accent/50 active:bg-accent/70`}
    >
      <ConnectorIcon entry={model.entry} size="md" />
      <div className="mt-3 w-full space-y-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {model.entry.name}
        </p>
        <p className="line-clamp-2 text-sm text-muted-foreground/90">
          {model.entry.oneLiner}
        </p>
      </div>
    </button>
  );
}

export function ConnectedConnectorCard({
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
  return (
    <div className={CARD_BASE}>
      <div className="flex w-full items-start justify-between gap-2">
        <ConnectorIcon entry={model.record.catalogEntry} size="md" />
        <ConnectorOverflowMenu
          disabled={pending}
          onDelete={onDelete}
          onManage={onManage}
          onReconnect={onReconnect}
          onToggle={onToggle}
          record={model.record}
        />
      </div>
      <div className="mt-3 w-full space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">
            {model.record.catalogEntry.name}
          </p>
          <ConnectorStatusChip
            status={model.status}
            onClick={model.status.actionable ? onStatusClick : undefined}
          />
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground/90">
          {model.record.catalogEntry.oneLiner}
        </p>
      </div>
    </div>
  );
}
