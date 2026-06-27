import { useEffect, useMemo, useState } from "react";
import type { CloudRepoConfigResponse } from "@proliferate/cloud-sdk";
import {
  useCloudRepoBranches,
  useCloudRepoConfig,
  useSaveCloudRepoConfig,
} from "@proliferate/cloud-sdk-react";
import { buildCoreCloudEnvironmentSaveRequest } from "@proliferate/product-domain/environments/cloud-environments";
import { formatGitRepoId } from "@proliferate/product-domain/repos/repo-id";
import { CloudEnvironmentEditor } from "@proliferate/product-ui/environments/CloudEnvironmentEditor";
import { Button } from "@proliferate/ui/primitives/Button";
import { CloudSecretsSettingsSurface } from "../CloudSecretsSettingsSurface";

interface CloudEnvironmentDraftState {
  configured: boolean;
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
  const config = useCloudRepoConfig(gitOwner, gitRepoName, enabled);
  const branches = useCloudRepoBranches(gitOwner, gitRepoName, enabled);
  const saveConfig = useSaveCloudRepoConfig();
  const draft = useCloudEnvironmentCoreDraft(config.data, repoId);
  const savedConfigured = config.data?.configured ?? false;
  const statusLabel = !draft.configured && savedConfigured
    ? "Will disable"
    : savedConfigured
      ? draft.dirty
        ? "Unsaved changes"
        : "Saved"
      : draft.configured
        ? "Ready to enable"
        : "Disabled";

  async function handleSave() {
    const response = await saveConfig.mutateAsync({
      gitOwner,
      gitRepoName,
      body: buildCoreCloudEnvironmentSaveRequest({
        configured: draft.configured,
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
      branchesLoading={branches.isLoading || config.isLoading}
      branchError={branches.error instanceof Error ? branches.error.message : null}
      setupScript={draft.setupScript}
      runCommand={draft.runCommand}
      saving={saveConfig.isPending}
      saveDisabled={!enabled || config.isLoading || saveConfig.isPending || !draft.canSave}
      revertDisabled={saveConfig.isPending || !draft.dirty}
      disableDisabled={!draft.configured}
      error={saveConfig.error?.message ?? null}
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
      onDisable={savedConfigured ? draft.disable : undefined}
    />
  );
}

function useCloudEnvironmentCoreDraft(
  config: CloudRepoConfigResponse | null | undefined,
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
  const configurable = !state.baseline.configured && normalizedDraft.configured;

  function patch(patch: Partial<Omit<CloudEnvironmentDraftState, "envVarRows">>) {
    setState((current) => ({
      ...current,
      draft: {
        ...current.draft,
        ...patch,
        configured: patch.configured ?? true,
      },
    }));
  }

  return {
    configured: normalizedDraft.configured,
    defaultBranch: normalizedDraft.defaultBranch,
    setupScript: normalizedDraft.setupScript,
    runCommand: normalizedDraft.runCommand,
    dirty,
    canSave: dirty || configurable,
    setDefaultBranch: (defaultBranch: string | null) => patch({ defaultBranch }),
    setSetupScript: (setupScript: string) => patch({ setupScript }),
    setRunCommand: (runCommand: string) => patch({ runCommand }),
    revert: () => {
      setState((current) => ({
        ...current,
        draft: current.revertDraft,
      }));
    },
    disable: () => patch({ configured: false }),
    reset: (nextConfig: CloudRepoConfigResponse) => {
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
  config: CloudRepoConfigResponse | null | undefined,
): {
  baseline: CloudEnvironmentDraftState;
  revertDraft: CloudEnvironmentDraftState;
  draft: CloudEnvironmentDraftState;
} {
  const baseline = buildSavedDraft(config);
  if (baseline.configured) {
    return {
      baseline,
      revertDraft: baseline,
      draft: baseline,
    };
  }
  const draft = {
    ...baseline,
    configured: true,
  };
  return {
    baseline,
    revertDraft: draft,
    draft,
  };
}

function buildSavedDraft(
  config: CloudRepoConfigResponse | null | undefined,
): CloudEnvironmentDraftState {
  return {
    configured: config?.configured ?? false,
    defaultBranch: config?.defaultBranch ?? null,
    setupScript: config?.setupScript ?? "",
    runCommand: config?.runCommand ?? "",
  };
}

function isDraftDirty(
  draft: CloudEnvironmentDraftState,
  baseline: CloudEnvironmentDraftState,
): boolean {
  return draft.configured !== baseline.configured
    || draft.defaultBranch !== baseline.defaultBranch
    || draft.setupScript !== baseline.setupScript
    || draft.runCommand !== baseline.runCommand;
}
