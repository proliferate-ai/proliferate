import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { CloudIcon } from "@proliferate/ui/icons";
import { CloudSecretsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudSecretsSettingsSurface";
import {
  EnvironmentPanel,
  EnvironmentPanelRow,
  EnvironmentSection,
} from "@proliferate/ui/layout/EnvironmentLayout";
import { CloudDefaultBranchCard } from "@/components/cloud/repo-settings/CloudDefaultBranchCard";
import { RepoRunCommandCard } from "@/components/cloud/repo-settings/RepoRunCommandCard";
import { RepoSetupScriptCard } from "@/components/cloud/repo-settings/RepoSetupScriptCard";
import { useCloudRepoBranches } from "@/hooks/access/cloud/use-cloud-repo-branches";
import { useCloudRepoConfig } from "@/hooks/access/cloud/use-cloud-repo-config";
import { useCloudRepoConfigDraft } from "@/hooks/cloud/ui/use-cloud-repo-config-draft";
import { useSaveCloudRepoConfig } from "@/hooks/cloud/workflows/use-save-cloud-repo-config";
import type { CloudRepoConfig } from "@/lib/domain/cloud/repo-configs";
import {
  isCloudRepository,
  type CloudSettingsRepositoryEntry,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
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
  savedConfig: CloudRepoConfig | null | undefined;
  localSetupScript: string;
  localRunCommand: string;
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
  const {
    data: branchInfo,
    isLoading: isLoadingBranches,
    error: branchError,
  } = useCloudRepoBranches(repository.gitOwner, repository.gitRepoName, cloudActive);
  const configured = savedConfig?.configured ?? false;
  const repoLabel = `${repository.gitOwner}/${repository.gitRepoName}`;
  const errorMessage = saveMutation.error?.message ?? null;
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
    const {
      configured,
      defaultBranch,
      setupScript,
      runCommand,
    } = draft.savePayload;
    const response = await saveMutation.mutateAsync({
      configured,
      defaultBranch,
      setupScript,
      runCommand,
    });
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

      <CloudSecretsSettingsSurface
        scope={{
          kind: "workspace",
          gitOwner: repository.gitOwner,
          gitRepoName: repository.gitRepoName,
        }}
        enabled={cloudActive && configured}
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
      isLoadingConfig={isLoadingConfig}
      cloudActive={cloudActive}
    />
  );
}
