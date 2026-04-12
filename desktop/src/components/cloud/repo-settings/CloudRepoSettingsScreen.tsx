import { useNavigate } from "react-router-dom";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  isCloudRepository,
  type CloudSettingsRepositoryEntry,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import { buildCloudSettingsHref } from "@/lib/domain/settings/navigation";
import type { CloudRepoConfigResponse } from "@/lib/integrations/cloud/client";
import { useCloudRepoConfig } from "@/hooks/cloud/use-cloud-repo-config";
import { useCloudRepoConfigDraft } from "@/hooks/cloud/use-cloud-repo-config-draft";
import { useCloudRepoBranches } from "@/hooks/cloud/use-cloud-repo-branches";
import { useCloudRepoSetupSuggestions } from "@/hooks/cloud/use-cloud-repo-setup-suggestions";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useSaveCloudRepoConfig } from "@/hooks/cloud/use-save-cloud-repo-config";
import { useResyncCloudRepoFile } from "@/hooks/cloud/use-resync-cloud-repo-file";
import { CloudDefaultBranchCard } from "./CloudDefaultBranchCard";
import { RepoEnvVarsCard } from "./RepoEnvVarsCard";
import { RepoTrackedFilesCard } from "./RepoTrackedFilesCard";
import { RepoSetupScriptCard } from "./RepoSetupScriptCard";

interface CloudRepoSettingsScreenProps {
  repository: SettingsRepositoryEntry | null;
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
  const navigate = useNavigate();
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
    <section className="space-y-6">
      <SettingsPageHeader
        title={repository.name}
        description={repository.secondaryLabel ?? repository.sourceRoot}
        action={(
          <div className="flex items-center gap-2">
            <Badge>{configured ? "Saved for cloud" : "Not saved yet"}</Badge>
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
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(buildCloudSettingsHref())}
            >
              Back to Cloud
            </Button>
          </div>
        )}
      />

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{repoLabel}</span>
        {isLoadingConfig && <span>Loading saved config…</span>}
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
    </section>
  );
}

export function CloudRepoSettingsScreen({
  repository,
}: CloudRepoSettingsScreenProps) {
  const localSetupScript = useRepoPreferencesStore(
    (state) => repository
      ? (state.repoConfigs[repository.sourceRoot]?.setupScript ?? "")
      : "",
  );
  const {
    data: savedConfig,
    isLoading: isLoadingConfig,
  } = useCloudRepoConfig(repository?.gitOwner, repository?.gitRepoName);
  const { suggestedPaths } = useCloudRepoSetupSuggestions(repository?.repoRootId);

  if (!isCloudRepository(repository)) {
    return (
      <section className="space-y-6">
        <SettingsPageHeader
          title="Cloud repo settings"
          description="Pick a GitHub-backed repository from the Cloud page to configure repo-specific cloud setup."
        />
      </section>
    );
  }

  if (isLoadingConfig) {
    return (
      <section className="space-y-6">
        <SettingsPageHeader
          title={repository.name}
          description={repository.secondaryLabel ?? repository.sourceRoot}
        />
        <div className="text-sm text-muted-foreground">Loading saved config…</div>
      </section>
    );
  }

  return (
    <CloudRepoSettingsEditor
      key={repository.sourceRoot}
      repository={repository}
      savedConfig={savedConfig}
      localSetupScript={localSetupScript}
      suggestedPaths={suggestedPaths}
      isLoadingConfig={isLoadingConfig}
    />
  );
}
