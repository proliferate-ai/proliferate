import { useEffect, useMemo, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { CloudEnvironmentEditor } from "@proliferate/product-ui/environments/CloudEnvironmentEditor";
import type { CloudEnvironmentEnvVarRowView } from "@proliferate/product-ui/environments/CloudEnvironmentEditor";
import { buildCoreCloudEnvironmentSaveRequest } from "@proliferate/product-model/environments/cloud-environments";
import { formatGitRepoId } from "@proliferate/product-model/repos/repo-id";
import { useCloudRepoBranches } from "@/hooks/access/cloud/use-cloud-repo-branches";
import { useCloudRepoConfig } from "@/hooks/access/cloud/use-cloud-repo-config";
import { useSavePersonalCloudRepoConfig } from "@/hooks/access/cloud/use-save-personal-cloud-repo-config";
import type { CloudRepoConfig } from "@/lib/domain/cloud/repo-configs";

interface CloudOnlyEnvironmentDetailProps {
  gitOwner: string;
  gitRepoName: string;
  cloudActive: boolean;
  onBack: () => void;
  onSaved: () => void;
}

interface CloudEnvironmentDraftState {
  configured: boolean;
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
  envVarRows: CloudEnvironmentEnvVarRowView[];
}

export function CloudOnlyEnvironmentDetail({
  gitOwner,
  gitRepoName,
  cloudActive,
  onBack,
  onSaved,
}: CloudOnlyEnvironmentDetailProps) {
  const repoId = formatGitRepoId({ gitOwner, gitRepoName });
  const config = useCloudRepoConfig(gitOwner, gitRepoName, cloudActive);
  const branches = useCloudRepoBranches(gitOwner, gitRepoName, cloudActive);
  const saveConfig = useSavePersonalCloudRepoConfig();
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
      description="Personal Cloud environment. This repo does not need to be cloned locally."
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
      saveDisabled={!cloudActive || config.isLoading || saveConfig.isPending || !draft.canSave}
      revertDisabled={saveConfig.isPending || !draft.dirty}
      disableDisabled={!draft.configured}
      error={saveConfig.error?.message ?? null}
      trackedFileCount={config.data?.trackedFiles.length ?? 0}
      trackedFilesReadOnly
      breadcrumb={(
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          className="h-auto px-0 py-0 text-sm hover:bg-transparent"
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
  config: CloudRepoConfig | null | undefined,
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

  const envVars = useMemo(() => rowsToEnvVars(state.draft.envVarRows), [state.draft.envVarRows]);
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
    reset: (nextConfig: CloudRepoConfig) => {
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
  config: CloudRepoConfig | null | undefined,
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
  config: CloudRepoConfig | null | undefined,
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
