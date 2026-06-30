import { useEffect, useMemo, useState } from "react";
import type { RepoEnvironmentResponse } from "@proliferate/cloud-sdk";
import {
  useCloudRepoBranches,
  useRepoConfigs,
  useSaveRepoEnvironment,
} from "@proliferate/cloud-sdk-react";
import { buildCoreCloudEnvironmentSaveRequest } from "@proliferate/product-domain/environments/cloud-environments";
import { formatGitRepoId } from "@proliferate/product-domain/repos/repo-id";
import { CloudEnvironmentEditor } from "@proliferate/product-ui/environments/CloudEnvironmentEditor";
import { Button } from "@proliferate/ui/primitives/Button";
import { CloudSecretsSettingsSurface } from "../CloudSecretsSettingsSurface";

interface CloudEnvironmentDraftState {
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
}

export function CloudEnvironmentDetail({
  gitOwner,
  gitRepoName,
  enabled,
  onBack,
  onSaved,
}: {
  gitOwner: string;
  gitRepoName: string;
  enabled: boolean;
  onBack: () => void;
  onSaved: () => void;
}) {
  const repoId = formatGitRepoId({ gitOwner, gitRepoName });
  const repoConfigs = useRepoConfigs(enabled);
  const cloudEnvironment = useMemo(() => {
    const repo = repoConfigs.data?.repositories.find((candidate) =>
      candidate.gitProvider === "github"
      && candidate.gitOwner === gitOwner
      && candidate.gitRepoName === gitRepoName
    );
    return repo?.environments.find((environment) => environment.kind === "cloud") ?? null;
  }, [gitOwner, gitRepoName, repoConfigs.data?.repositories]);
  const branches = useCloudRepoBranches(gitOwner, gitRepoName, enabled);
  const saveEnvironment = useSaveRepoEnvironment();
  const draft = useCloudEnvironmentCoreDraft(cloudEnvironment, repoId);
  const savedConfigured = cloudEnvironment !== null;
  const statusLabel = savedConfigured
    ? draft.dirty
      ? "Unsaved changes"
      : "Saved"
    : "Ready to enable";

  async function handleSave() {
    const response = await saveEnvironment.mutateAsync({
      gitOwner,
      gitRepoName,
      body: buildCoreCloudEnvironmentSaveRequest({
        defaultBranch: draft.defaultBranch,
        setupScript: draft.setupScript,
        runCommand: draft.runCommand,
      }),
    });
    draft.reset(response);
    onSaved();
  }

  return (
    <CloudEnvironmentEditor
      title={repoId}
      description="Personal Cloud environment. This does not create or require a local checkout."
      statusLabel={statusLabel}
      statusTone={savedConfigured ? (draft.dirty ? "warning" : "success") : "warning"}
      defaultBranch={draft.defaultBranch}
      githubDefaultBranch={branches.data?.defaultBranch ?? null}
      branches={branches.data?.branches ?? []}
      branchesLoading={branches.isLoading || repoConfigs.isLoading}
      branchError={branches.error instanceof Error ? branches.error.message : null}
      setupScript={draft.setupScript}
      runCommand={draft.runCommand}
      saving={saveEnvironment.isPending}
      saveDisabled={!enabled || repoConfigs.isLoading || saveEnvironment.isPending || !draft.canSave}
      revertDisabled={saveEnvironment.isPending || !draft.dirty}
      error={saveEnvironment.error?.message ?? null}
      secretsSlot={(
        <CloudSecretsSettingsSurface
          scope={{ kind: "workspace", gitOwner, gitRepoName }}
          enabled={enabled && savedConfigured}
        />
      )}
      breadcrumb={(
        <Button
          type="button"
          variant="ghost"
          className="h-auto px-0 py-0 text-sm hover:bg-transparent"
          onClick={onBack}
        >
          Environments / {repoId}
        </Button>
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

function useCloudEnvironmentCoreDraft(
  config: RepoEnvironmentResponse | null | undefined,
  sourceKey: string,
) {
  const initial = useMemo(() => buildInitialDraftState(config), [config]);
  const [state, setState] = useState(() => ({
    sourceKey,
    baseline: initial.baseline,
    revertDraft: initial.revertDraft,
    draft: initial.draft,
  }));

  useEffect(() => {
    const sourceChanged = state.sourceKey !== sourceKey;
    if (sourceChanged || !isDraftDirty(state.draft, state.revertDraft)) {
      setState({
        sourceKey,
        baseline: initial.baseline,
        revertDraft: initial.revertDraft,
        draft: initial.draft,
      });
    }
  }, [initial, sourceKey, state.draft, state.revertDraft, state.sourceKey]);

  const normalizedDraft = state.draft;
  const dirty = isDraftDirty(normalizedDraft, state.revertDraft);
  const baselineExists = config !== null && config !== undefined;

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
    defaultBranch: normalizedDraft.defaultBranch,
    setupScript: normalizedDraft.setupScript,
    runCommand: normalizedDraft.runCommand,
    dirty,
    canSave: dirty || !baselineExists,
    setDefaultBranch: (defaultBranch: string | null) => patch({ defaultBranch }),
    setSetupScript: (setupScript: string) => patch({ setupScript }),
    setRunCommand: (runCommand: string) => patch({ runCommand }),
    revert: () => {
      setState((current) => ({
        ...current,
        draft: current.revertDraft,
      }));
    },
    reset: (nextConfig: RepoEnvironmentResponse) => {
      const next = buildInitialDraftState(nextConfig);
      setState({
        sourceKey,
        baseline: next.baseline,
        revertDraft: next.revertDraft,
        draft: next.draft,
      });
    },
  };
}

function buildInitialDraftState(
  config: RepoEnvironmentResponse | null | undefined,
): {
  baseline: CloudEnvironmentDraftState;
  revertDraft: CloudEnvironmentDraftState;
  draft: CloudEnvironmentDraftState;
} {
  const baseline = buildSavedDraft(config);
  return {
    baseline,
    revertDraft: baseline,
    draft: baseline,
  };
}

function buildSavedDraft(
  config: RepoEnvironmentResponse | null | undefined,
): CloudEnvironmentDraftState {
  return {
    defaultBranch: config?.defaultBranch ?? null,
    setupScript: config?.setupScript ?? "",
    runCommand: config?.runCommand ?? "",
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
