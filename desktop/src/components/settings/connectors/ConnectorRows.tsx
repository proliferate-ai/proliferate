import { useId, type ReactNode } from "react";
import type { ConnectorCatalogEntry, InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { ConnectorIcon } from "./ConnectorShared";

function getInstalledStatus(record: InstalledConnectorRecord) {
  if (record.broken) {
    return {
      description: "Add a token to use this connector.",
      tone: "text-destructive",
      retry: false,
    } as const;
  }
  if (!record.metadata.enabled) {
    return {
      description: "Off. New sessions won't include this connector.",
      tone: "text-muted-foreground",
      retry: false,
    } as const;
  }
  if (record.metadata.syncState === "degraded") {
    return {
      description: "Cloud sync couldn't finish. We'll retry automatically.",
      tone: "text-muted-foreground",
      retry: true,
    } as const;
  }
  return null;
}

function ConnectorRow({
  children,
  isFirst,
}: {
  children: ReactNode;
  isFirst: boolean;
}) {
  return (
    <div className={`px-4 py-3 ${isFirst ? "" : "border-t border-border/50"}`}>
      {children}
    </div>
  );
}

export function AvailableConnectorRow({
  entry,
  isFirst,
  onConnect,
}: {
  entry: ConnectorCatalogEntry;
  isFirst: boolean;
  onConnect: () => void;
}) {
  return (
    <ConnectorRow isFirst={isFirst}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ConnectorIcon entry={entry} />
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium text-foreground">{entry.name}</div>
            <p className="text-sm text-muted-foreground/80">{entry.oneLiner}</p>
          </div>
        </div>
        <div className="shrink-0">
          <Button type="button" variant="outline" size="sm" onClick={onConnect}>
            Connect
          </Button>
        </div>
      </div>
    </ConnectorRow>
  );
}

export function InstalledConnectorRow({
  isFirst,
  isPending,
  onManage,
  onRetry,
  onToggle,
  record,
}: {
  isFirst: boolean;
  isPending: boolean;
  onManage: () => void;
  onRetry: () => void;
  onToggle: (enabled: boolean) => void;
  record: InstalledConnectorRecord;
}) {
  const status = getInstalledStatus(record);
  const statusId = useId();

  return (
    <ConnectorRow isFirst={isFirst}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <ConnectorIcon entry={record.catalogEntry} />
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm font-medium text-foreground">
                  {record.catalogEntry.name}
                </div>
                {record.metadata.syncState === "synced" && !record.broken && (
                  <Badge>Installed</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground/80">{record.catalogEntry.oneLiner}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Switch
              checked={record.metadata.enabled}
              onChange={onToggle}
              disabled={isPending}
              aria-label={`Use ${record.catalogEntry.name} in new sessions`}
              aria-describedby={status ? statusId : undefined}
            />
            <Button type="button" variant="outline" size="sm" onClick={onManage} disabled={isPending}>
              Manage
            </Button>
          </div>
        </div>
        {status && (
          <div
            id={statusId}
            className={`flex items-center gap-2 text-xs ${status.tone}`}
          >
            <span>{status.description}</span>
            {status.retry && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRetry}
                disabled={isPending}
                aria-label={`Retry sync for ${record.catalogEntry.name}`}
              >
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
    </ConnectorRow>
  );
}
