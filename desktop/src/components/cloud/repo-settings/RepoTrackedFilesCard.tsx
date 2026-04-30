import { useMemo, useState } from "react";
import type { CloudRepoFileMetadata } from "@/lib/integrations/cloud/client";
import {
  EnvironmentAdvancedDisclosure,
  EnvironmentField,
} from "@/components/settings/EnvironmentSettingsLayout";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PickerEmptyRow, PickerPopoverContent } from "@/components/ui/PickerPopoverContent";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Check, ChevronUpDown, RefreshCw, X } from "@/components/ui/icons";
import { matchesPickerSearch } from "@/lib/infra/search";

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
  const [searchValue, setSearchValue] = useState("");

  const trackedFilesByPath = useMemo(
    () => new Map(trackedFiles.map((file) => [file.relativePath, file])),
    [trackedFiles],
  );
  const selectablePaths = useMemo(() => (
    Array.from(new Set([...trackedFilePaths, ...suggestedPaths])).sort((a, b) => a.localeCompare(b))
  ), [suggestedPaths, trackedFilePaths]);
  const filteredPaths = useMemo(() => selectablePaths.filter((relativePath) =>
    matchesPickerSearch([relativePath], searchValue)), [searchValue, selectablePaths]);
  const normalizedSearchPath = searchValue.trim();
  const canAddSearchPath =
    normalizedSearchPath.length > 0
    && !trackedFilePaths.includes(normalizedSearchPath)
    && !selectablePaths.includes(normalizedSearchPath);
  const triggerLabel = trackedFilePaths.length === 0
    ? "Choose tracked files"
    : `${trackedFilePaths.length} tracked ${trackedFilePaths.length === 1 ? "file" : "files"}`;

  return (
    <EnvironmentAdvancedDisclosure
      title="Advanced"
      description="Tracked repo-relative files and setup-detected sync suggestions."
    >
      <EnvironmentField
        label="Tracked files"
        description="Saving syncs every selected path from your local repo into cloud storage."
      >
        <div className="space-y-3">
          <PopoverButton
            align="start"
            trigger={(
              <Button
                type="button"
                variant="outline"
                size="md"
                className="w-64 justify-between bg-background px-2.5 text-foreground shadow-none hover:bg-accent/50"
              >
                <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
                <ChevronUpDown className="size-3 shrink-0 text-muted-foreground" />
              </Button>
            )}
            className="w-96 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-floating"
          >
            {() => (
              <PickerPopoverContent
                searchValue={searchValue}
                searchPlaceholder="Search or add repo-relative path"
                onSearchChange={setSearchValue}
                emptyLabel="No paths found"
              >
                {canAddSearchPath ? (
                  <PopoverMenuItem
                    label={`Add ${normalizedSearchPath}`}
                    onClick={() => {
                      if (onAddTrackedFile(normalizedSearchPath)) {
                        setSearchValue("");
                      }
                    }}
                  >
                    <span className="truncate text-xs text-muted-foreground">
                      Add as a repo-relative tracked file
                    </span>
                  </PopoverMenuItem>
                ) : null}

                {filteredPaths.length === 0 && !canAddSearchPath ? (
                  <PickerEmptyRow label="No paths found" />
                ) : filteredPaths.map((relativePath) => {
                  const selected = trackedFilePaths.includes(relativePath);
                  return (
                    <PopoverMenuItem
                      key={relativePath}
                      label={relativePath}
                      className={selected ? "text-foreground" : "text-muted-foreground"}
                      trailing={selected ? <Check className="size-3.5" /> : undefined}
                      onClick={() => {
                        if (selected) {
                          onRemoveTrackedFile(relativePath);
                          return;
                        }
                        onAddTrackedFile(relativePath);
                      }}
                    >
                      <span className="truncate text-xs text-muted-foreground">
                        {suggestedPaths.includes(relativePath) ? "Suggested from setup detection" : "Selected tracked path"}
                      </span>
                    </PopoverMenuItem>
                  );
                })}
              </PickerPopoverContent>
            )}
          </PopoverButton>

          {trackedFilePaths.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tracked files yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {trackedFilePaths.map((relativePath) => {
                const trackedFile = trackedFilesByPath.get(relativePath);
                const syncing = syncPathInFlight === relativePath;
                return (
                  <span
                    key={relativePath}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-foreground/5 py-1 pl-2.5 pr-1 text-xs text-foreground"
                  >
                    <span className="max-w-56 truncate">{relativePath}</span>
                    <Badge>{trackedFile ? "Tracked" : "Pending"}</Badge>
                    {trackedFile ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        loading={syncing}
                        disabled={!canSyncTrackedFiles || syncing}
                        aria-label={`Sync ${relativePath} from local`}
                        onClick={() => onResyncTrackedFile(relativePath)}
                      >
                        <RefreshCw className="size-3" />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Stop tracking ${relativePath}`}
                      onClick={() => onRemoveTrackedFile(relativePath)}
                    >
                      <X className="size-3" />
                    </Button>
                  </span>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Paths are repo-relative. Existing cloud workspaces only get updated when you re-sync a tracked file.
          </p>
        </div>
      </EnvironmentField>
    </EnvironmentAdvancedDisclosure>
  );
}
