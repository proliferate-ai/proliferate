import type { CloudRepoFileMetadata } from "@/lib/integrations/cloud/client";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Badge } from "@/components/ui/Badge";

interface CloudWorkspaceTrackedFilesCardProps {
  trackedFiles: CloudRepoFileMetadata[];
}

export function CloudWorkspaceTrackedFilesCard({
  trackedFiles,
}: CloudWorkspaceTrackedFilesCardProps) {
  return (
    <SettingsCard className="divide-y-0 bg-sidebar/60">
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Tracked files</p>
          <Badge>{trackedFiles.length}</Badge>
        </div>
        {trackedFiles.length > 0 ? (
          <div className="space-y-2">
            {trackedFiles.map((file) => (
              <div
                key={file.relativePath}
                className="rounded-lg border border-border/60 bg-background/40 px-3 py-2"
              >
                <div className="truncate text-sm text-foreground">{file.relativePath}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Updated {new Date(file.updatedAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No tracked files are saved for this repo yet.
          </p>
        )}
      </div>
    </SettingsCard>
  );
}
