import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";
import {
  getConnectorAuthLabel,
  getConnectorAvailabilityLabel,
} from "@/lib/domain/mcp/display";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { Button } from "@/components/ui/Button";
import { ExternalLink } from "@/components/ui/icons";

export function ConnectorAboutTab({ entry }: { entry: ConnectorCatalogEntry }) {
  const authLabel = getConnectorAuthLabel(entry);
  const availabilityLabel = getConnectorAvailabilityLabel(entry);
  const { openExternal } = useTauriShellActions();

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground/90">{entry.description}</p>

      <dl className="space-y-2 text-xs">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
          <dt className="text-muted-foreground">Auth</dt>
          <dd className="text-foreground">{authLabel}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
          <dt className="text-muted-foreground">Where it works</dt>
          <dd className="text-foreground">{availabilityLabel}</dd>
        </div>
      </dl>

      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => { void openExternal(entry.docsUrl); }}
        >
          Open docs
          <ExternalLink className="size-3" />
        </Button>
      </div>
    </div>
  );
}
