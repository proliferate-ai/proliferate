import { useEffect, useMemo, useState } from "react";
import {
  useCloudRepoBranches,
  useCloudRepoConfig,
  useCloudRepoConfigs,
  useSaveCloudRepoConfig,
} from "@proliferate/cloud-sdk-react";
import type { CloudRepoConfigResponse } from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { CloudEnvironmentEditor } from "@proliferate/product-ui/environments/CloudEnvironmentEditor";
import type { CloudEnvironmentEnvVarRowView } from "@proliferate/product-ui/environments/CloudEnvironmentEditor";
import { CloudEnvironmentList } from "@proliferate/product-ui/environments/CloudEnvironmentList";
import {
  buildCloudEnvironmentListItems,
  buildCoreCloudEnvironmentSaveRequest,
} from "@proliferate/product-model/environments/cloud-environments";
import {
  formatGitRepoId,
} from "@proliferate/product-model/repos/repo-id";

import { AddCloudEnvironmentDialogController } from "../../environments/screen/AddCloudEnvironmentDialogController";

interface CloudEnvironmentDraftState {
  configured: boolean;
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
  envVarRows: CloudEnvironmentEnvVarRowView[];
}

export function EnvironmentsSettingsSection() {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const repoConfigs = useCloudRepoConfigs();
  const environments = useMemo(
    () => buildCloudEnvironmentListItems({
      configs: repoConfigs.data?.configs ?? [],
    }),
    [repoConfigs.data?.configs],
  );
  const selectedEnvironment = useMemo(
    () => environments.find((environment) => environment.id === selectedRepoId) ?? null,
    [environments, selectedRepoId],
  );

  if (selectedEnvironment) {
    return (
      <CloudEnvironmentDetail
        gitOwner={selectedEnvironment.gitOwner}
        gitRepoName={selectedEnvironment.gitRepoName}
        onBack={() => setSelectedRepoId(null)}
        onSaved={() => void repoConfigs.refetch()}
      />
    );
  }

  return (
    <>
      <CloudEnvironmentList
        title="Environments"
        description="Personal Cloud environments are GitHub repositories Proliferate can run without a local clone."
        cloudEnvironments={environments.map((environment) => ({
          id: environment.id,
          fullName: environment.fullName,
          description: environment.description,
          configured: environment.configured,
          localState: environment.localState,
        }))}
        loadingCloudEnvironments={repoConfigs.isLoading}
        cloudUnavailableReason={repoConfigs.isError ? "Cloud environments could not be loaded." : null}
        onSelectCloudEnvironment={setSelectedRepoId}
        onAddCloudEnvironment={() => setAddOpen(true)}
        onRetryCloudEnvironments={repoConfigs.isError ? () => void repoConfigs.refetch() : undefined}
      />
      <AddCloudEnvironmentDialogController
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onEnvironmentAdded={(repoId) => {
          setSelectedRepoId(repoId);
          void repoConfigs.refetch();
        }}
      />
    </>
  );
}

function CloudEnvironmentDetail({
  gitOwner,
  gitRepoName,
  onBack,
  onSaved,
}: {
  gitOwner: string;
  gitRepoName: string;
  onBack: () => void;
  onSaved: () => void;
}) {
  const config = useCloudRepoConfig(gitOwner, gitRepoName, true);
  const branches = useCloudRepoBranches(gitOwner, gitRepoName, true);
  const saveConfig = useSaveCloudRepoConfig();
  const draft = useCloudEnvironmentCoreDraft(config.data, formatGitRepoId({ gitOwner, gitRepoName }));
  const repoId = formatGitRepoId({ gitOwner, gitRepoName });
  const errorMessage = saveConfig.error?.message ?? null;
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
        envVars: draft.envVars,
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
      envVarRows={draft.envVarRows}
      saving={saveConfig.isPending}
      saveDisabled={config.isLoading || saveConfig.isPending || !draft.canSave}
      revertDisabled={saveConfig.isPending || !draft.dirty}
      disableDisabled={!draft.configured}
      error={errorMessage}
      trackedFileCount={config.data?.trackedFiles.length ?? 0}
      trackedFilesReadOnly
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
      onAddEnvVar={draft.addEnvVar}
      onUpdateEnvVar={draft.updateEnvVar}
      onRemoveEnvVar={draft.removeEnvVar}
      onSave={() => { void handleSave(); }}
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
    if (!sourceChanged && !isDraftDirty(state.draft, state.revertDraft)) {
      setState({
        sourceKey,
        baseline: initial.baseline,
        revertDraft: initial.revertDraft,
        draft: initial.draft,
      });
      return;
    }
    if (sourceChanged) {
      setState({
        sourceKey,
        baseline: initial.baseline,
        revertDraft: initial.revertDraft,
        draft: initial.draft,
      });
    }
  }, [initial, sourceKey, state.draft, state.revertDraft, state.sourceKey]);

  const envVars = useMemo(() => (
    Object.fromEntries(
      state.draft.envVarRows
        .map((row) => [row.key.trim(), row.value] as const)
        .filter(([key]) => key.length > 0),
    )
  ), [state.draft.envVarRows]);
  const normalizedDraft = useMemo(() => ({
    ...state.draft,
    envVarRows: buildEnvVarRows(envVars),
  }), [envVars, state.draft]);
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
    envVarRows: state.draft.envVarRows,
    envVars,
    dirty,
    canSave: dirty || configurable,
    setDefaultBranch: (defaultBranch: string | null) => patch({ defaultBranch }),
    setSetupScript: (setupScript: string) => patch({ setupScript }),
    setRunCommand: (runCommand: string) => patch({ runCommand }),
    addEnvVar: () => {
      setState((current) => ({
        ...current,
        draft: {
          ...current.draft,
          configured: true,
          envVarRows: [...current.draft.envVarRows, { id: createRowId(), key: "", value: "" }],
        },
      }));
    },
    updateEnvVar: (
      rowId: string,
      rowPatch: Partial<Pick<CloudEnvironmentEnvVarRowView, "key" | "value">>,
    ) => {
      setState((current) => ({
        ...current,
        draft: {
          ...current.draft,
          configured: true,
          envVarRows: current.draft.envVarRows.map((row) =>
            row.id === rowId ? { ...row, ...rowPatch } : row),
        },
      }));
    },
    removeEnvVar: (rowId: string) => {
      setState((current) => ({
        ...current,
        draft: {
          ...current.draft,
          configured: true,
          envVarRows: current.draft.envVarRows.filter((row) => row.id !== rowId),
        },
      }));
    },
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
    envVarRows: buildEnvVarRows(config?.envVars ?? {}),
  };
}

function buildEnvVarRows(envVars: Record<string, string>): CloudEnvironmentEnvVarRowView[] {
  return Object.entries(envVars)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ id: createRowId(), key, value }));
}

function isDraftDirty(
  draft: CloudEnvironmentDraftState,
  baseline: CloudEnvironmentDraftState,
): boolean {
  return draft.configured !== baseline.configured
    || draft.defaultBranch !== baseline.defaultBranch
    || draft.setupScript !== baseline.setupScript
    || draft.runCommand !== baseline.runCommand
    || JSON.stringify(rowsToEnvVars(draft.envVarRows)) !== JSON.stringify(rowsToEnvVars(baseline.envVarRows));
}

function rowsToEnvVars(rows: readonly CloudEnvironmentEnvVarRowView[]): Record<string, string> {
  return Object.fromEntries(
    rows
      .map((row) => [row.key.trim(), row.value] as const)
      .filter(([key]) => key.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function createRowId(): string {
  return crypto.randomUUID();
}
