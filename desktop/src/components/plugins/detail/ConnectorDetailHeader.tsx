import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";
import { ConnectorIcon } from "@/components/plugins/status/ConnectorIcon";

export function ConnectorDetailHeader({ entry }: { entry: ConnectorCatalogEntry }) {
  return (
    <div className="flex items-center gap-3">
      <ConnectorIcon entry={entry} size="sm" />
      <span className="truncate text-base font-medium tracking-tight">
        {entry.name}
      </span>
    </div>
  );
}
