import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CloudIcon } from "@/components/ui/icons";
import {
  EnvironmentPanel,
  EnvironmentPanelRow,
  EnvironmentSection,
} from "@/components/ui/EnvironmentLayout";
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

function CloudEnvironmentNotice({
  description,
}: {
  description: string;
}) {
  return (
    <EnvironmentSection title="Cloud environment" icon={CloudIcon} separated>
      <EnvironmentPanel>
        <EnvironmentPanelRow>
          <p className="text-sm text-muted-foreground">{description}</p>
        </EnvironmentPanelRow>
      </EnvironmentPanel>
    </EnvironmentSection>
  );
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
  const revertDisabled = saveMutation.isPending || !draft.dirty;
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
    <EnvironmentSection
      title="Cloud environment"
      icon={CloudIcon}
      separated
      description={(
        <>
          Saved to Proliferate Cloud for {repoLabel}
          {isLoadingConfig ? " · Loading saved config..." : ""}.
        </>
      )}
      action={(
        <>
          <Badge>{statusLabel}</Badge>
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
            Save
          </Button>
        </>
      )}
    >
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

      <RepoRunCommandCard
        runCommand={draft.runCommand}
        onChange={draft.setRunCommand}
      />

      <RepoSetupScriptCard
        setupScript={draft.setupScript}
        onChange={draft.setSetupScript}
      />

      <RepoEnvVarsCard
        rows={draft.envVarRows}
        onAddRow={draft.addEnvVarRow}
        onUpdateRow={draft.updateEnvVarRow}
        onRemoveRow={draft.removeEnvVarRow}
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
    </EnvironmentSection>
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
      <CloudEnvironmentNotice description="Cloud environments are available for GitHub-backed repositories." />
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
      <CloudEnvironmentNotice description={description} />
    );
  }

  if (isLoadingConfig) {
    return (
      <CloudEnvironmentNotice description="Loading saved cloud environment..." />
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
