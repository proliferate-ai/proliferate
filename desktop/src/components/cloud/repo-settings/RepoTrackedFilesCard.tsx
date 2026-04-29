import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type { CloudRepoFileMetadata } from "@/lib/integrations/cloud/client";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

interface RepoTrackedFilesCardProps {
  trackedFilePaths: string[];
  trackedFiles: CloudRepoFileMetadata[];
  suggestedPaths: string[];
  canSyncTrackedFiles: boolean;
  syncPathInFlight: string | null;
  onAddTrackedFile: (relativePath: string) => boolean;
  onRemoveTrackedFile: (relativePath: string) => void;
  onResyncTrackedFile: (relativePath: string) => void;
}

export function RepoTrackedFilesCard({
  trackedFilePaths,
  trackedFiles,
  suggestedPaths,
  canSyncTrackedFiles,
  syncPathInFlight,
  onAddTrackedFile,
  onRemoveTrackedFile,
  onResyncTrackedFile,
}: RepoTrackedFilesCardProps) {
  const [manualPath, setManualPath] = useState("");

  const trackedFilesByPath = useMemo(
    () => new Map(trackedFiles.map((file) => [file.relativePath, file])),
    [trackedFiles],
  );

  return (
    <SettingsCard>
      <SettingsCardRow
        label="Cloud tracked files"
        description="Saving syncs every tracked path from your local repo into cloud storage. Existing cloud workspaces only get updated when you re-sync files from that workspace."
      >
        <div className="w-[32rem] max-w-full space-y-4">
          <div className="space-y-2">
            {trackedFilePaths.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tracked files yet. Add a repo-relative path or use one of the suggestions below.
              </p>
            ) : (
              trackedFilePaths.map((relativePath) => {
                const trackedFile = trackedFilesByPath.get(relativePath);
                const syncing = syncPathInFlight === relativePath;
                return (
                  <div
                    key={relativePath}
                    className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {relativePath}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {trackedFile
                          ? `Stored locally on ${new Date(trackedFile.updatedAt).toLocaleString()}`
                          : "Will sync on save."}
                      </div>
                    </div>
                    <Badge>{trackedFile ? "Tracked" : "Pending save"}</Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onRemoveTrackedFile(relativePath)}
                    >
                      Remove
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      loading={syncing}
                      disabled={!canSyncTrackedFiles || syncing}
                      onClick={() => onResyncTrackedFile(relativePath)}
                    >
                      Sync from local
                    </Button>
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={manualPath}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setManualPath(event.target.value)}
                placeholder=".env.local or apps/web/.env.local"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (onAddTrackedFile(manualPath)) {
                    setManualPath("");
                  }
                }}
              >
                Add path
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paths are repo-relative. Subdirectories are allowed.
            </p>
          </div>

          {suggestedPaths.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Suggested from setup detection</p>
              <div className="space-y-2">
                {suggestedPaths.map((relativePath) => {
                  const alreadyTracked = trackedFilePaths.includes(relativePath);
                  return (
                    <div
                      key={relativePath}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2"
                    >
                      <div className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {relativePath}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={alreadyTracked}
                        onClick={() => {
                          onAddTrackedFile(relativePath);
                        }}
                      >
                        {alreadyTracked ? "Added" : "Track file"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </SettingsCardRow>
    </SettingsCard>
  );
}
