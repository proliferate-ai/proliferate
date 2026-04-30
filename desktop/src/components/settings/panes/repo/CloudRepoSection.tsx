import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CloudDefaultBranchCard } from "@/components/cloud/repo-settings/CloudDefaultBranchCard";
import { RepoEnvVarsCard } from "@/components/cloud/repo-settings/RepoEnvVarsCard";
import { RepoRunCommandCard } from "@/components/cloud/repo-settings/RepoRunCommandCard";
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
  cloudEnabled: boolean;
  cloudActive: boolean;
  cloudSignInChecking: boolean;
  cloudSignInAvailable: boolean;
}

interface CloudRepoSettingsEditorProps {
  repository: CloudSettingsRepositoryEntry;
  savedConfig: CloudRepoConfigResponse | null | undefined;
  localSetupScript: string;
  localRunCommand: string;
  suggestedPaths: string[];
  isLoadingConfig: boolean;
  cloudActive: boolean;
}

function CloudRepoSettingsEditor({
  repository,
  savedConfig,
  localSetupScript,
  localRunCommand,
  suggestedPaths,
  isLoadingConfig,
  cloudActive,
}: CloudRepoSettingsEditorProps) {
  const draft = useCloudRepoConfigDraft({
    savedConfig,
    localSetupScript,
    localRunCommand,
    sourceKey: `${repository.sourceRoot}:${repository.repoRootId}`,
  });
  const saveMutation = useSaveCloudRepoConfig(repository);
  const resyncFileMutation = useResyncCloudRepoFile(repository);
  const {
    data: branchInfo,
    isLoading: isLoadingBranches,
    error: branchError,
  } = useCloudRepoBranches(repository.gitOwner, repository.gitRepoName, cloudActive);
  const configured = savedConfig?.configured ?? false;
  const repoLabel = `${repository.gitOwner}/${repository.gitRepoName}`;
  const errorMessage = saveMutation.error?.message ?? resyncFileMutation.error?.message ?? null;
  const saveDisabled =
    !cloudActive || isLoadingConfig || saveMutation.isPending || !draft.canSave;
  const revertDisabled =
    saveMutation.isPending || (!draft.dirty && !draft.configurable);
  const statusLabel = !draft.configured && configured
    ? "Will disable"
    : configured
      ? draft.dirty
        ? "Unsaved changes"
        : "Saved"
      : draft.configured
        ? "Not saved yet"
        : "Disabled";

  async function handleSave() {
    const response = await saveMutation.mutateAsync(draft.savePayload);
    draft.resetFromSavedConfig(response);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">Cloud environment</p>
          <p className="text-sm text-muted-foreground">
            Saved to Proliferate Cloud and used when creating cloud workspaces for this repo.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/50 p-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">Cloud save state</p>
              <Badge>{statusLabel}</Badge>
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
                disabled={!draft.configured || saveMutation.isPending}
                onClick={draft.disable}
              >
                {draft.configured ? "Disable cloud environment" : "Disable pending"}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={revertDisabled}
              onClick={draft.revert}
            >
              Revert
            </Button>
            <Button
              type="button"
              loading={saveMutation.isPending}
              disabled={saveDisabled}
              onClick={() => { void handleSave(); }}
            >
              Save cloud environment
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
        canSyncTrackedFiles={cloudActive && configured && draft.configured}
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

      <RepoRunCommandCard
        runCommand={draft.runCommand}
        onChange={draft.setRunCommand}
      />

      <RepoSetupScriptCard
        setupScript={draft.setupScript}
        onChange={draft.setSetupScript}
      />
    </div>
  );
}

export function CloudRepoSection({
  repository,
  cloudEnabled,
  cloudActive,
  cloudSignInChecking,
  cloudSignInAvailable,
}: CloudRepoSectionProps) {
  const localSetupScript = useRepoPreferencesStore(
    (state) => state.repoConfigs[repository.sourceRoot]?.setupScript ?? "",
  );
  const localRunCommand = useRepoPreferencesStore(
    (state) => state.repoConfigs[repository.sourceRoot]?.runCommand ?? "",
  );
  const cloudRepository = isCloudRepository(repository) ? repository : null;
  const cloudQueryEnabled = cloudActive && Boolean(cloudRepository);
  const {
    data: savedConfig,
    isLoading: isLoadingConfig,
  } = useCloudRepoConfig(
    cloudRepository?.gitOwner,
    cloudRepository?.gitRepoName,
    cloudQueryEnabled,
  );
  const { suggestedPaths } = useCloudRepoSetupSuggestions(repository.repoRootId);

  if (!cloudRepository) {
    return (
      <div className="space-y-1.5 rounded-lg border border-border bg-card/50 p-3">
        <p className="text-sm font-medium text-foreground">Cloud environment</p>
        <p className="text-sm text-muted-foreground">
          Cloud environments are available for GitHub-backed repositories.
        </p>
      </div>
    );
  }

  if (!cloudEnabled || !cloudActive) {
    const description = !cloudEnabled
      ? "Cloud environments are unavailable in this build or deployment."
      : cloudSignInChecking
        ? "Checking cloud sign-in before loading this environment."
        : cloudSignInAvailable
          ? "Sign in to configure this cloud environment."
          : "GitHub sign-in is unavailable, so cloud environment settings cannot load.";

    return (
      <div className="space-y-1.5 rounded-lg border border-border bg-card/50 p-3">
        <p className="text-sm font-medium text-foreground">Cloud environment</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    );
  }

  if (isLoadingConfig) {
    return (
      <div className="space-y-1.5 rounded-lg border border-border bg-card/50 p-3">
        <p className="text-sm font-medium text-foreground">Cloud environment</p>
        <p className="text-sm text-muted-foreground">Loading saved cloud environment...</p>
      </div>
    );
  }

  return (
    <CloudRepoSettingsEditor
      key={`${repository.sourceRoot}:${repository.repoRootId}`}
      repository={cloudRepository}
      savedConfig={savedConfig}
      localSetupScript={localSetupScript}
      localRunCommand={localRunCommand}
      suggestedPaths={suggestedPaths}
      isLoadingConfig={isLoadingConfig}
      cloudActive={cloudActive}
    />
  );
}
