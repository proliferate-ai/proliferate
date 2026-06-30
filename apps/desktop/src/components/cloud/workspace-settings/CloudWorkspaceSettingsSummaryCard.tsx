import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";

interface CloudWorkspaceSettingsSummaryCardProps {
  repoLabel: string;
  filesOutOfSync: boolean;
  repoFilesAppliedVersion: number;
  currentRepoFilesVersion: number;
  postReadyLabel: string;
  postReadyProgress: string | null;
  setupStatusLabel: string;
  errorMessage: string | null;
  isResyncingFiles: boolean;
  isRunningSetup: boolean;
  canResyncFiles: boolean;
  canRunSetup: boolean;
  onResyncFiles: () => void;
  onRunSetup: () => void;
  onConfigureRepo: () => void;
}

export function CloudWorkspaceSettingsSummaryCard({
  repoLabel,
  filesOutOfSync,
  repoFilesAppliedVersion,
  currentRepoFilesVersion,
  postReadyLabel,
  postReadyProgress,
  setupStatusLabel,
  errorMessage,
  isResyncingFiles,
  isRunningSetup,
  canResyncFiles,
  canRunSetup,
  onResyncFiles,
  onRunSetup,
  onConfigureRepo,
}: CloudWorkspaceSettingsSummaryCardProps) {
  return (
    <SettingsCard className="divide-y-0">
      <div className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">Cloud workspace settings</p>
            <p className="truncate text-xs text-muted-foreground">{repoLabel}</p>
          </div>
          <Badge>{filesOutOfSync ? "Files out of sync" : "Files in sync"}</Badge>
        </div>

        <div className="grid gap-2 text-xs text-muted-foreground">
          <div>
            Files version {repoFilesAppliedVersion} applied to this workspace.
            Repo is at version {currentRepoFilesVersion}.
          </div>
          <div>
            Post-ready phase: {postReadyLabel}
            {postReadyProgress ? ` (${postReadyProgress})` : ""}
          </div>
          <div>Live setup status: {setupStatusLabel}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canResyncFiles && (
            <Button
              type="button"
              variant="outline"
              loading={isResyncingFiles}
              onClick={onResyncFiles}
            >
              Re-sync files
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            loading={isRunningSetup}
            disabled={!canRunSetup}
            onClick={onRunSetup}
          >
            Run setup again
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onConfigureRepo}
          >
            Configure repo
          </Button>
        </div>

        {errorMessage && (
          <p className="text-xs text-destructive">{errorMessage}</p>
        )}
      </div>
    </SettingsCard>
  );
}
