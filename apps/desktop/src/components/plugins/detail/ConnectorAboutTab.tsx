import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";
import {
  getConnectorAuthLabel,
  getConnectorAvailabilityLabel,
} from "@/lib/domain/mcp/display";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { Button } from "@proliferate/ui/primitives/Button";
import { ExternalLink } from "@proliferate/ui/icons";

export function ConnectorAboutTab({ entry }: { entry: ConnectorCatalogEntry }) {
  const authLabel = getConnectorAuthLabel(entry);
  const availabilityLabel = getConnectorAvailabilityLabel(entry);
  const { openExternal } = useTauriShellActions();

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground/90">{entry.description}</p>

      <dl className="overflow-hidden rounded-lg border border-border/50 bg-surface-elevated-secondary text-xs divide-y divide-border/50">
        <div className="grid min-h-12 items-center gap-1 px-4 py-2 sm:grid-cols-[128px_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Auth</dt>
          <dd className="text-foreground sm:text-right">{authLabel}</dd>
        </div>
        <div className="grid min-h-12 items-center gap-1 px-4 py-2 sm:grid-cols-[128px_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Where it works</dt>
          <dd className="text-foreground sm:text-right">{availabilityLabel}</dd>
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
