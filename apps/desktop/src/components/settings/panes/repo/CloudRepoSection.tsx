import { useEffect, useMemo, useState } from "react";
import type { RepoEnvironmentResponse } from "@proliferate/cloud-sdk";
import { useRepositories, useSaveRepoEnvironment } from "@proliferate/cloud-sdk-react";
import { buildCoreCloudEnvironmentSaveRequest } from "@proliferate/product-domain/environments/cloud-environments";
import { CloudEnvironmentEditor } from "@proliferate/product-ui/environments/CloudEnvironmentEditor";
import { CloudIcon } from "@proliferate/ui/icons";
import {
  EnvironmentPanel,
  EnvironmentPanelRow,
  EnvironmentSection,
} from "@proliferate/ui/layout/EnvironmentLayout";
import { CloudSecretsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudSecretsSettingsSurface";
import { useCloudRepoBranches } from "@/hooks/access/cloud/use-cloud-repo-branches";
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

interface CloudEnvironmentDraftState {
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
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
  cloudEnvironment,
  localSetupScript,
  localRunCommand,
  repoConfigsLoading,
  cloudActive,
}: {
  repository: CloudSettingsRepositoryEntry;
  cloudEnvironment: RepoEnvironmentResponse | null;
  localSetupScript: string;
  localRunCommand: string;
  repoConfigsLoading: boolean;
  cloudActive: boolean;
}) {
  const draft = useCloudEnvironmentDraft({
    cloudEnvironment,
    localSetupScript,
    localRunCommand,
    sourceKey: `${repository.sourceRoot}:${repository.repoRootId}`,
  });
  const saveEnvironment = useSaveRepoEnvironment();
  const {
    data: branchInfo,
    isLoading: isLoadingBranches,
    error: branchError,
  } = useCloudRepoBranches(repository.gitOwner, repository.gitRepoName, cloudActive);
  const configured = cloudEnvironment !== null;
  const repoLabel = `${repository.gitOwner}/${repository.gitRepoName}`;
  const statusLabel = configured
    ? draft.dirty
      ? "Unsaved changes"
      : "Saved"
    : "Ready to enable";

  async function handleSave() {
    const response = await saveEnvironment.mutateAsync({
      gitOwner: repository.gitOwner,
      gitRepoName: repository.gitRepoName,
      body: buildCoreCloudEnvironmentSaveRequest({
        defaultBranch: draft.defaultBranch,
        setupScript: draft.setupScript,
        runCommand: draft.runCommand,
      }),
    });
    draft.reset(response);
  }

  return (
    <CloudEnvironmentEditor
      title="Cloud environment"
      description={`Saved to Proliferate Cloud for ${repoLabel}.`}
      statusLabel={statusLabel}
      statusTone={configured ? (draft.dirty ? "warning" : "success") : "warning"}
      defaultBranch={draft.defaultBranch}
      githubDefaultBranch={branchInfo?.defaultBranch ?? null}
      branches={branchInfo?.branches ?? []}
      branchesLoading={isLoadingBranches || repoConfigsLoading}
      branchError={branchError instanceof Error ? branchError.message : null}
      setupScript={draft.setupScript}
      runCommand={draft.runCommand}
      saving={saveEnvironment.isPending}
      saveDisabled={!cloudActive || repoConfigsLoading || saveEnvironment.isPending || !draft.canSave}
      revertDisabled={saveEnvironment.isPending || !draft.dirty}
      error={saveEnvironment.error?.message ?? null}
      secretsSlot={(
        <CloudSecretsSettingsSurface
          scope={{
            kind: "workspace",
            gitOwner: repository.gitOwner,
            gitRepoName: repository.gitRepoName,
          }}
          enabled={cloudActive && configured}
        />
      )}
      onDefaultBranchChange={draft.setDefaultBranch}
      onSetupScriptChange={draft.setSetupScript}
      onRunCommandChange={draft.setRunCommand}
      onSave={() => {
        void handleSave();
      }}
      onRevert={draft.revert}
    />
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
  const repoConfigs = useRepositories(cloudQueryEnabled);
  const cloudEnvironment = useMemo(() => {
    if (!cloudRepository) {
      return null;
    }
    const repo = repoConfigs.data?.repositories.find((candidate) =>
      candidate.gitProvider === "github"
      && candidate.gitOwner === cloudRepository.gitOwner
      && candidate.gitRepoName === cloudRepository.gitRepoName
    );
    return repo?.environments.find((environment) => environment.kind === "cloud") ?? null;
  }, [cloudRepository, repoConfigs.data?.repositories]);

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

  if (repoConfigs.isLoading) {
    return (
      <CloudEnvironmentNotice description="Loading saved cloud environment..." />
    );
  }

  return (
    <CloudRepoSettingsEditor
      key={`${repository.sourceRoot}:${repository.repoRootId}`}
      repository={cloudRepository}
      cloudEnvironment={cloudEnvironment}
      localSetupScript={localSetupScript}
      localRunCommand={localRunCommand}
      repoConfigsLoading={repoConfigs.isLoading}
      cloudActive={cloudActive}
    />
  );
}

function useCloudEnvironmentDraft({
  cloudEnvironment,
  localSetupScript,
  localRunCommand,
  sourceKey,
}: {
  cloudEnvironment: RepoEnvironmentResponse | null;
  localSetupScript: string;
  localRunCommand: string;
  sourceKey: string;
}) {
  const initialDraftState = useMemo(
    () => buildInitialDraftState({
      cloudEnvironment,
      localSetupScript,
      localRunCommand,
    }),
    [cloudEnvironment, localRunCommand, localSetupScript],
  );
  const [state, setState] = useState(() => ({
    activeSourceKey: sourceKey,
    revertDraft: initialDraftState,
    draft: initialDraftState,
  }));

  const dirty = isDraftDirty(state.draft, state.revertDraft);
  const canSave = dirty || cloudEnvironment === null;

  useEffect(() => {
    const sourceChanged = state.activeSourceKey !== sourceKey;
    if (!sourceChanged && dirty) {
      return;
    }

    setState({
      activeSourceKey: sourceKey,
      revertDraft: initialDraftState,
      draft: initialDraftState,
    });
  }, [dirty, initialDraftState, sourceKey, state.activeSourceKey]);

  function patch(patch: Partial<CloudEnvironmentDraftState>) {
    setState((current) => ({
      ...current,
      draft: {
        ...current.draft,
        ...patch,
      },
    }));
  }

  return {
    defaultBranch: state.draft.defaultBranch,
    setDefaultBranch: (defaultBranch: string | null) => patch({ defaultBranch }),
    setupScript: state.draft.setupScript,
    setSetupScript: (setupScript: string) => patch({ setupScript }),
    runCommand: state.draft.runCommand,
    setRunCommand: (runCommand: string) => patch({ runCommand }),
    dirty,
    canSave,
    revert: () => {
      setState((current) => ({
        ...current,
        draft: current.revertDraft,
      }));
    },
    reset: (nextEnvironment: RepoEnvironmentResponse) => {
      const nextState = buildInitialDraftState({
        cloudEnvironment: nextEnvironment,
        localSetupScript,
        localRunCommand,
      });
      setState((current) => ({
        ...current,
        revertDraft: nextState,
        draft: nextState,
      }));
    },
  };
}

function buildInitialDraftState({
  cloudEnvironment,
  localSetupScript,
  localRunCommand,
}: {
  cloudEnvironment: RepoEnvironmentResponse | null;
  localSetupScript: string;
  localRunCommand: string;
}): CloudEnvironmentDraftState {
  return {
    defaultBranch: cloudEnvironment?.defaultBranch ?? null,
    setupScript: cloudEnvironment?.setupScript ?? localSetupScript,
    runCommand: cloudEnvironment?.runCommand ?? localRunCommand,
  };
}

function isDraftDirty(
  draft: CloudEnvironmentDraftState,
  baseline: CloudEnvironmentDraftState,
): boolean {
  return draft.defaultBranch !== baseline.defaultBranch
    || draft.setupScript !== baseline.setupScript
    || draft.runCommand !== baseline.runCommand;
}
