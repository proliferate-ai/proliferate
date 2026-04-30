import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CloudDefaultBranchCard } from "@/components/cloud/repo-settings/CloudDefaultBranchCard";
import { RepoEnvVarsCard } from "@/components/cloud/repo-settings/RepoEnvVarsCard";
import { RepoSetupScriptCard } from "@/components/cloud/repo-settings/RepoSetupScriptCard";
import { RepoTrackedFilesCard } from "@/components/cloud/repo-settings/RepoTrackedFilesCard";
import { useCloudRepoBranches } from "@/hooks/cloud/use-cloud-repo-branches";
import { useCloudRepoConfig } from "@/hooks/cloud/use-cloud-repo-config";
import { useCloudRepoConfigDraft } from "@/hooks/cloud/use-cloud-repo-config-draft";
import { useCloudRepoSetupSuggestions } from "@/hooks/cloud/use-cloud-repo-setup-suggestions";
import { useResyncCloudRepoFile } from "@/hooks/cloud/use-resync-cloud-repo-file";
import { useSaveCloudRepoConfig } from "@/hooks/cloud/use-save-cloud-repo-config";
import {
  isCloudRepository,
  type CloudSettingsRepositoryEntry,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import type { CloudRepoConfigResponse } from "@/lib/integrations/cloud/client";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";

interface CloudRepoSectionProps {
  repository: SettingsRepositoryEntry;
}

interface CloudRepoSettingsEditorProps {
  repository: CloudSettingsRepositoryEntry;
  savedConfig: CloudRepoConfigResponse | null | undefined;
  localSetupScript: string;
  suggestedPaths: string[];
  isLoadingConfig: boolean;
}

function CloudRepoSettingsEditor({
  repository,
  savedConfig,
  localSetupScript,
  suggestedPaths,
  isLoadingConfig,
}: CloudRepoSettingsEditorProps) {
  const draft = useCloudRepoConfigDraft({
    savedConfig,
    localSetupScript,
  });
  const saveMutation = useSaveCloudRepoConfig(repository);
  const resyncFileMutation = useResyncCloudRepoFile(repository);
  const {
    data: branchInfo,
    isLoading: isLoadingBranches,
    error: branchError,
  } = useCloudRepoBranches(repository.gitOwner, repository.gitRepoName);
  const configured = savedConfig?.configured ?? false;
  const repoLabel = `${repository.gitOwner}/${repository.gitRepoName}`;
  const errorMessage = saveMutation.error?.message ?? resyncFileMutation.error?.message ?? null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">Cloud configuration</p>
          <p className="text-sm text-muted-foreground">
            Saved to Proliferate Cloud and used when creating cloud workspaces for this repository.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/50 p-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">Cloud save state</p>
              <Badge>{configured ? "Saved" : "Not saved yet"}</Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {repoLabel}
              {isLoadingConfig ? " · Loading saved config..." : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {configured && (
              <Button
                type="button"
                variant="outline"
                loading={saveMutation.isPending}
                onClick={() => {
                  void saveMutation.mutateAsync({
                    configured: false,
                    defaultBranch: null,
                    envVars: {},
                    trackedFilePaths: [],
                    setupScript: "",
                  });
                }}
              >
                Disable cloud config
              </Button>
            )}
            <Button
              type="button"
              loading={saveMutation.isPending}
              onClick={() => {
                void saveMutation.mutateAsync({
                  defaultBranch: draft.defaultBranch,
                  envVars: draft.envVars,
                  trackedFilePaths: draft.trackedFilePaths,
                  setupScript: draft.setupScript,
                });
              }}
            >
              Save cloud config
            </Button>
          </div>
        </div>
      </div>

      {errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}

      <CloudDefaultBranchCard
        value={draft.defaultBranch}
        githubDefaultBranch={branchInfo?.defaultBranch ?? null}
        branches={branchInfo?.branches ?? []}
        isLoading={isLoadingBranches}
        errorMessage={branchError instanceof Error ? branchError.message : null}
        onChange={draft.setDefaultBranch}
      />

      <RepoTrackedFilesCard
        trackedFilePaths={draft.trackedFilePaths}
        trackedFiles={savedConfig?.trackedFiles ?? []}
        suggestedPaths={suggestedPaths}
        canSyncTrackedFiles={configured}
        syncPathInFlight={
          resyncFileMutation.isPending
            ? (resyncFileMutation.variables?.relativePath ?? null)
            : null
        }
        onAddTrackedFile={draft.addTrackedFile}
        onRemoveTrackedFile={draft.removeTrackedFile}
        onResyncTrackedFile={(relativePath) => {
          void resyncFileMutation.mutateAsync({ relativePath });
        }}
      />

      <RepoEnvVarsCard
        rows={draft.envVarRows}
        onAddRow={draft.addEnvVarRow}
        onUpdateRow={draft.updateEnvVarRow}
        onRemoveRow={draft.removeEnvVarRow}
      />

      <RepoSetupScriptCard
        setupScript={draft.setupScript}
        onChange={draft.setSetupScript}
      />
    </div>
  );
}

export function CloudRepoSection({ repository }: CloudRepoSectionProps) {
  const localSetupScript = useRepoPreferencesStore(
    (state) => state.repoConfigs[repository.sourceRoot]?.setupScript ?? "",
  );
  const {
    data: savedConfig,
    isLoading: isLoadingConfig,
  } = useCloudRepoConfig(repository.gitOwner, repository.gitRepoName);
  const { suggestedPaths } = useCloudRepoSetupSuggestions(repository.repoRootId);

  if (!isCloudRepository(repository)) {
    return (
      <div className="space-y-1.5 rounded-lg border border-border bg-card/50 p-3">
        <p className="text-sm font-medium text-foreground">Cloud configuration</p>
        <p className="text-sm text-muted-foreground">
          Cloud repo settings are available for GitHub-backed repositories.
        </p>
      </div>
    );
  }

  if (isLoadingConfig) {
    return (
      <div className="space-y-1.5 rounded-lg border border-border bg-card/50 p-3">
        <p className="text-sm font-medium text-foreground">Cloud configuration</p>
        <p className="text-sm text-muted-foreground">Loading saved cloud config...</p>
      </div>
    );
  }

  return (
    <CloudRepoSettingsEditor
      key={`${repository.sourceRoot}:${repository.repoRootId}`}
      repository={repository}
      savedConfig={savedConfig}
      localSetupScript={localSetupScript}
      suggestedPaths={suggestedPaths}
      isLoadingConfig={isLoadingConfig}
    />
  );
}
