import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import {
  EnvironmentPanel,
  EnvironmentPanelRow,
  EnvironmentSection,
} from "@/components/ui/EnvironmentLayout";
import { useRuntimeInputSyncSummary } from "@/hooks/cloud/facade/use-runtime-input-sync-summary";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

interface AutomaticSyncSectionProps {
  repositories: SettingsRepositoryEntry[];
}

export function AutomaticSyncSection({ repositories }: AutomaticSyncSectionProps) {
  const runtimeInputSync = useRuntimeInputSyncSummary(repositories);

  return (
    <EnvironmentSection
      title="Cloud input sync"
      description="Keep local credentials and tracked repo files synced for personal cloud workspaces."
    >
      <EnvironmentPanel>
        <EnvironmentPanelRow>
          <div className="flex w-full items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-foreground">Sync personal cloud inputs</h3>
              <p className="text-sm text-muted-foreground">
                Runs in the background when Desktop is open.
              </p>
            </div>
            <Switch
              checked={runtimeInputSync.enabled}
              onChange={runtimeInputSync.setEnabled}
              aria-label="Automatically sync personal cloud inputs"
            />
          </div>
        </EnvironmentPanelRow>
        {runtimeInputSync.rows.map((row) => (
          <EnvironmentPanelRow key={row.id}>
            <div className="flex w-full items-center justify-between gap-3">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-foreground">{row.label}</h4>
                <p className="text-sm text-muted-foreground">{row.description}</p>
              </div>
              <Badge>{statusLabel(row.status)}</Badge>
            </div>
          </EnvironmentPanelRow>
        ))}
      </EnvironmentPanel>
    </EnvironmentSection>
  );
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}
