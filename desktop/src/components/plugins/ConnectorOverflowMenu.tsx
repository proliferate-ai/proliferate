import type { InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { IconButton } from "@/components/ui/IconButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { MoreHorizontal } from "@/components/ui/icons";

export function ConnectorOverflowMenu({
  disabled = false,
  onDelete,
  onManage,
  onReconnect,
  onToggle,
  record,
}: {
  disabled?: boolean;
  onDelete: () => void;
  onManage: () => void;
  onReconnect?: () => void;
  onToggle: (enabled: boolean) => void;
  record: InstalledConnectorRecord;
}) {
  const isOAuth =
    record.catalogEntry.transport === "http" && record.catalogEntry.authKind === "oauth";
  const enabled = record.metadata.enabled;

  return (
    <PopoverButton
      align="end"
      side="bottom"
      stopPropagation
      trigger={
        <IconButton
          size="sm"
          title={`Actions for ${record.catalogEntry.name}`}
          disabled={disabled}
          className="rounded-md"
        >
          <MoreHorizontal className="size-4" />
        </IconButton>
      }
    >
      {(close) => (
        <div className="flex flex-col gap-0.5">
          <PopoverMenuItem
            label="Manage"
            onClick={() => {
              close();
              onManage();
            }}
          />
          {isOAuth && onReconnect && (
            <PopoverMenuItem
              label="Reconnect"
              onClick={() => {
                close();
                onReconnect();
              }}
            />
          )}
          <PopoverMenuItem
            label={enabled ? "Turn off" : "Turn on"}
            onClick={() => {
              close();
              onToggle(!enabled);
            }}
          />
          <PopoverMenuItem
            label="Delete"
            onClick={() => {
              close();
              onDelete();
            }}
          />
        </div>
      )}
    </PopoverButton>
  );
}
