import type { ReactNode } from "react";
import type {
  AvailableCardModel,
  ConnectedCardModel,
} from "@/hooks/mcp/use-connectors-catalog-state";
import {
  getConnectorAuthLabel,
  getConnectorAvailabilityLabel,
} from "@/lib/domain/mcp/display";
import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";
import { ConnectorIcon } from "./ConnectorIcon";
import { ConnectorOverflowMenu } from "./ConnectorOverflowMenu";
import { ConnectorStatusChip } from "./ConnectorStatusChip";

function CardShell({
  children,
  interactive = false,
  onClick,
}: {
  children: ReactNode;
  interactive?: boolean;
  onClick?: () => void;
}) {
  const base =
    "group flex h-full flex-col rounded-xl border border-border bg-card p-4 text-left transition-colors";

  if (interactive && onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} hover:bg-accent/40`}>
        {children}
      </button>
    );
  }

  return <div className={base}>{children}</div>;
}

function ConnectorCardHeader({
  entry,
  trailing,
}: {
  entry: ConnectorCatalogEntry;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <ConnectorIcon entry={entry} size="md" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {entry.name}
          </div>
        </div>
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}

function ConnectorCardBody({ entry }: { entry: ConnectorCatalogEntry }) {
  return (
    <p className="mt-3 line-clamp-2 text-sm text-muted-foreground/90">
      {entry.oneLiner}
    </p>
  );
}

function ConnectorCardFooter({ entry }: { entry: ConnectorCatalogEntry }) {
  const auth = getConnectorAuthLabel(entry);
  const availability = getConnectorAvailabilityLabel(entry);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
      <span>{auth}</span>
      <span aria-hidden="true">·</span>
      <span>{availability}</span>
    </div>
  );
}

export function AvailableConnectorCard({
  model,
  onConnect,
}: {
  model: AvailableCardModel;
  onConnect: () => void;
}) {
  return (
    <CardShell interactive onClick={onConnect}>
      <ConnectorCardHeader entry={model.entry} />
      <ConnectorCardBody entry={model.entry} />
      <div className="mt-auto">
        <ConnectorCardFooter entry={model.entry} />
      </div>
    </CardShell>
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
    <CardShell>
      <ConnectorCardHeader
        entry={model.record.catalogEntry}
        trailing={(
          <div className="flex items-center gap-1">
            <ConnectorStatusChip
              status={model.status}
              onClick={model.status.actionable ? onStatusClick : undefined}
            />
            <ConnectorOverflowMenu
              disabled={pending}
              onDelete={onDelete}
              onManage={onManage}
              onReconnect={onReconnect}
              onToggle={onToggle}
              record={model.record}
            />
          </div>
        )}
      />
      <ConnectorCardBody entry={model.record.catalogEntry} />
      <div className="mt-auto">
        <ConnectorCardFooter entry={model.record.catalogEntry} />
      </div>
    </CardShell>
  );
}
