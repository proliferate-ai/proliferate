import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildConfiguredCloudEnvironmentDraft,
  buildCloudEnvironmentSavePayload,
  buildDisabledCloudEnvironmentDraft,
  buildInitialCloudEnvironmentDraftState,
  buildSavedCloudEnvironmentDraftState,
  isCloudEnvironmentDraftConfigurable,
  isCloudEnvironmentDraftDirty,
  normalizeCloudEnvironmentDraft,
  type CloudEnvironmentDraft,
  type CloudEnvironmentDraftState,
} from "@/lib/domain/settings/environment-draft";
import type { CloudRepoConfigResponse } from "@/lib/access/cloud/client";

export interface CloudRepoEnvVarRow {
  id: string;
  key: string;
  value: string;
}

function createRowId(): string {
  return crypto.randomUUID();
}

function buildEnvVarRows(envVars: Record<string, string>): CloudRepoEnvVarRow[] {
  return Object.entries(envVars)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => ({
      id: createRowId(),
      key,
      value,
    }));
}

interface UseCloudRepoConfigDraftArgs {
  savedConfig: CloudRepoConfigResponse | null | undefined;
  localSetupScript: string;
  localRunCommand: string;
  sourceKey: string;
}

interface CloudRepoDraftViewState {
  draftState: CloudEnvironmentDraftState;
  activeSourceKey: string;
  envVarRows: CloudRepoEnvVarRow[];
}

export function useCloudRepoConfigDraft({
  savedConfig,
  localSetupScript,
  localRunCommand,
  sourceKey,
}: UseCloudRepoConfigDraftArgs) {
  const localSeed = useMemo(() => ({
    setupScript: localSetupScript,
    runCommand: localRunCommand,
  }), [localRunCommand, localSetupScript]);
  const initialDraftState = useMemo(
    () => buildInitialCloudEnvironmentDraftState(savedConfig, localSeed),
    [localSeed, savedConfig],
  );
  const [state, setState] = useState<CloudRepoDraftViewState>(() => ({
    draftState: initialDraftState,
    activeSourceKey: sourceKey,
    envVarRows: buildEnvVarRows(initialDraftState.draft.envVars),
  }));

  const envVars = useMemo(() => (
    state.envVarRows.reduce<Record<string, string>>((accumulator, row) => {
      const key = row.key.trim();
      if (!key) {
        return accumulator;
      }
      accumulator[key] = row.value;
      return accumulator;
    }, {})
  ), [state.envVarRows]);
  const currentDraft = useMemo(
    () => normalizeCloudEnvironmentDraft({
      ...state.draftState.draft,
      envVars,
    }),
    [state.draftState.draft, envVars],
  );
  const dirty = isCloudEnvironmentDraftDirty(currentDraft, state.draftState.revertDraft);
  const configurable = isCloudEnvironmentDraftConfigurable(currentDraft, state.draftState.baseline);
  const savePayload = useMemo(
    () => buildCloudEnvironmentSavePayload(currentDraft),
    [currentDraft],
  );

  useEffect(() => {
    const sourceChanged = state.activeSourceKey !== sourceKey;
    if (!sourceChanged && dirty) {
      return;
    }

    setState({
      draftState: initialDraftState,
      activeSourceKey: sourceKey,
      envVarRows: buildEnvVarRows(initialDraftState.draft.envVars),
    });
  }, [dirty, initialDraftState, sourceKey, state.activeSourceKey]);

  const updateDraft = useCallback((patch: Partial<CloudEnvironmentDraft>) => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: buildConfiguredCloudEnvironmentDraft(current.draftState.draft, patch),
      },
    }));
  }, []);

  const addEnvVarRow = useCallback(() => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: buildConfiguredCloudEnvironmentDraft(current.draftState.draft),
      },
      envVarRows: [
        ...current.envVarRows,
        { id: createRowId(), key: "", value: "" },
      ],
    }));
  }, []);

  const updateEnvVarRow = useCallback((
    rowId: string,
    patch: Partial<Pick<CloudRepoEnvVarRow, "key" | "value">>,
  ) => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: buildConfiguredCloudEnvironmentDraft(current.draftState.draft),
      },
      envVarRows: current.envVarRows.map((row) =>
        row.id === rowId ? { ...row, ...patch } : row),
    }));
  }, []);

  const removeEnvVarRow = useCallback((rowId: string) => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: buildConfiguredCloudEnvironmentDraft(current.draftState.draft),
      },
      envVarRows: current.envVarRows.filter((row) => row.id !== rowId),
    }));
  }, []);

  const addTrackedFile = useCallback((relativePath: string) => {
    const normalizedPath = relativePath.trim();
    if (!normalizedPath) {
      return false;
    }

    let added = false;
    setState((current) => {
      if (current.draftState.draft.trackedFilePaths.includes(normalizedPath)) {
        return current;
      }
      added = true;
      return {
        ...current,
        draftState: {
          ...current.draftState,
          draft: buildConfiguredCloudEnvironmentDraft(current.draftState.draft, {
            trackedFilePaths: [...current.draftState.draft.trackedFilePaths, normalizedPath],
          }),
        },
      };
    });
    return added;
  }, []);

  const removeTrackedFile = useCallback((relativePath: string) => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: buildConfiguredCloudEnvironmentDraft(current.draftState.draft, {
          trackedFilePaths: current.draftState.draft.trackedFilePaths.filter(
            (path) => path !== relativePath,
          ),
        }),
      },
    }));
  }, []);

  const revert = useCallback(() => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: current.draftState.revertDraft,
      },
      envVarRows: buildEnvVarRows(current.draftState.revertDraft.envVars),
    }));
  }, []);

  const disable = useCallback(() => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: buildDisabledCloudEnvironmentDraft(),
      },
      envVarRows: [],
    }));
  }, []);

  const resetFromSavedConfig = useCallback((nextSavedConfig: CloudRepoConfigResponse | null | undefined) => {
    const nextState = buildSavedCloudEnvironmentDraftState(nextSavedConfig);
    setState((current) => ({
      ...current,
      draftState: nextState,
      envVarRows: buildEnvVarRows(nextState.draft.envVars),
    }));
  }, []);

  return {
    configured: currentDraft.configured,
    defaultBranch: currentDraft.defaultBranch,
    setDefaultBranch: (defaultBranch: string | null) => updateDraft({ defaultBranch }),
    envVarRows: state.envVarRows,
    envVars,
    trackedFilePaths: currentDraft.trackedFilePaths,
    setupScript: currentDraft.setupScript,
    setSetupScript: (setupScript: string) => updateDraft({ setupScript }),
    runCommand: currentDraft.runCommand,
    setRunCommand: (runCommand: string) => updateDraft({ runCommand }),
    dirty,
    configurable,
    canSave: dirty || configurable,
    savePayload,
    addEnvVarRow,
    updateEnvVarRow,
    removeEnvVarRow,
    addTrackedFile,
    removeTrackedFile,
    revert,
    disable,
    resetFromSavedConfig,
  };
}
