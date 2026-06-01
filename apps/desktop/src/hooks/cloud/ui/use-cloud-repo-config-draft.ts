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
import {
  buildCloudRepoEnvVarRows,
  buildCloudRepoEnvVarsFromRows,
  buildCloudRepoSharedEnvFilePayloads,
  buildCloudRepoSharedEnvFiles,
  buildEmptyCloudRepoSharedEnvFile,
  cloudRepoSharedEnvFilesEqual,
  type CloudRepoEnvVarRow,
  type CloudRepoSharedEnvFile,
} from "@/lib/domain/settings/cloud-repo-config-draft";
import type { CloudRepoConfig } from "@/lib/domain/cloud/repo-configs";

function createRowId(): string {
  return crypto.randomUUID();
}

interface UseCloudRepoConfigDraftArgs {
  savedConfig: CloudRepoConfig | null | undefined;
  localSetupScript: string;
  localRunCommand: string;
  sourceKey: string;
}

interface CloudRepoDraftViewState {
  draftState: CloudEnvironmentDraftState;
  activeSourceKey: string;
  envVarRows: CloudRepoEnvVarRow[];
  sharedEnvFiles: CloudRepoSharedEnvFile[];
  revertSharedEnvFiles: CloudRepoSharedEnvFile[];
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
    envVarRows: buildCloudRepoEnvVarRows(initialDraftState.draft.envVars, createRowId),
    sharedEnvFiles: buildCloudRepoSharedEnvFiles(savedConfig, createRowId),
    revertSharedEnvFiles: buildCloudRepoSharedEnvFiles(savedConfig, createRowId),
  }));

  const envVars = useMemo(
    () => buildCloudRepoEnvVarsFromRows(state.envVarRows),
    [state.envVarRows],
  );
  const currentDraft = useMemo(
    () => normalizeCloudEnvironmentDraft({
      ...state.draftState.draft,
      envVars,
    }),
    [state.draftState.draft, envVars],
  );
  const sharedEnvFilesDirty = !cloudRepoSharedEnvFilesEqual(
    state.sharedEnvFiles,
    state.revertSharedEnvFiles,
  );
  const dirty = isCloudEnvironmentDraftDirty(currentDraft, state.draftState.revertDraft)
    || sharedEnvFilesDirty;
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
      envVarRows: buildCloudRepoEnvVarRows(initialDraftState.draft.envVars, createRowId),
      sharedEnvFiles: buildCloudRepoSharedEnvFiles(savedConfig, createRowId),
      revertSharedEnvFiles: buildCloudRepoSharedEnvFiles(savedConfig, createRowId),
    });
  }, [dirty, initialDraftState, savedConfig, sourceKey, state.activeSourceKey]);

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

  const addSharedEnvFile = useCallback(() => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: buildConfiguredCloudEnvironmentDraft(current.draftState.draft),
      },
      sharedEnvFiles: [
        ...current.sharedEnvFiles,
        buildEmptyCloudRepoSharedEnvFile({
          files: current.sharedEnvFiles,
          createId: createRowId,
        }),
      ],
    }));
  }, []);

  const updateSharedEnvFilePath = useCallback((fileId: string, relativePath: string) => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: buildConfiguredCloudEnvironmentDraft(current.draftState.draft),
      },
      sharedEnvFiles: current.sharedEnvFiles.map((file) =>
        file.id === fileId ? { ...file, relativePath } : file),
    }));
  }, []);

  const addSharedEnvFileRow = useCallback((fileId: string) => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: buildConfiguredCloudEnvironmentDraft(current.draftState.draft),
      },
      sharedEnvFiles: current.sharedEnvFiles.map((file) => (
        file.id === fileId
          ? { ...file, rows: [...file.rows, { id: createRowId(), key: "", value: "" }] }
          : file
      )),
    }));
  }, []);

  const updateSharedEnvFileRow = useCallback((
    fileId: string,
    rowId: string,
    patch: Partial<Pick<CloudRepoEnvVarRow, "key" | "value">>,
  ) => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: buildConfiguredCloudEnvironmentDraft(current.draftState.draft),
      },
      sharedEnvFiles: current.sharedEnvFiles.map((file) => (
        file.id === fileId
          ? {
              ...file,
              rows: file.rows.map((row) =>
                row.id === rowId ? { ...row, ...patch } : row),
            }
          : file
      )),
    }));
  }, []);

  const removeSharedEnvFileRow = useCallback((fileId: string, rowId: string) => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: buildConfiguredCloudEnvironmentDraft(current.draftState.draft),
      },
      sharedEnvFiles: current.sharedEnvFiles.map((file) => (
        file.id === fileId
          ? { ...file, rows: file.rows.filter((row) => row.id !== rowId) }
          : file
      )),
    }));
  }, []);

  const removeSharedEnvFile = useCallback((fileId: string) => {
    setState((current) => ({
      ...current,
      draftState: {
        ...current.draftState,
        draft: buildConfiguredCloudEnvironmentDraft(current.draftState.draft),
      },
      sharedEnvFiles: current.sharedEnvFiles.filter((file) => file.id !== fileId),
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
      envVarRows: buildCloudRepoEnvVarRows(current.draftState.revertDraft.envVars, createRowId),
      sharedEnvFiles: current.revertSharedEnvFiles,
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
      sharedEnvFiles: [],
    }));
  }, []);

  const resetFromSavedConfig = useCallback((nextSavedConfig: CloudRepoConfig | null | undefined) => {
    const nextState = buildSavedCloudEnvironmentDraftState(nextSavedConfig);
    setState((current) => ({
      ...current,
      draftState: nextState,
      envVarRows: buildCloudRepoEnvVarRows(nextState.draft.envVars, createRowId),
      sharedEnvFiles: buildCloudRepoSharedEnvFiles(nextSavedConfig, createRowId),
      revertSharedEnvFiles: buildCloudRepoSharedEnvFiles(nextSavedConfig, createRowId),
    }));
  }, []);

  return {
    configured: currentDraft.configured,
    defaultBranch: currentDraft.defaultBranch,
    setDefaultBranch: (defaultBranch: string | null) => updateDraft({ defaultBranch }),
    envVarRows: state.envVarRows,
    envVars,
    sharedEnvFiles: state.sharedEnvFiles,
    sharedEnvFilesDirty,
    sharedEnvFilePayloads: buildCloudRepoSharedEnvFilePayloads(state.sharedEnvFiles),
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
    addSharedEnvFile,
    updateSharedEnvFilePath,
    addSharedEnvFileRow,
    updateSharedEnvFileRow,
    removeSharedEnvFileRow,
    removeSharedEnvFile,
    addTrackedFile,
    removeTrackedFile,
    revert,
    disable,
    resetFromSavedConfig,
  };
}
