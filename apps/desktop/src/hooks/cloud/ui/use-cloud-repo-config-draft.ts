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
  envFileVariablesEqual,
  parseEnvFileVariables,
  serializeEnvFileVariablesPreservingOriginal,
  type EnvFileVariable,
} from "@/lib/domain/settings/env-file-draft";
import type { CloudRepoConfig } from "@/lib/domain/cloud/repo-configs";

export interface CloudRepoEnvVarRow {
  id: string;
  key: string;
  value: string;
}

export interface CloudRepoSharedEnvFile {
  id: string;
  relativePath: string;
  rows: CloudRepoEnvVarRow[];
  originalContent: string | null;
  originalVariables: EnvFileVariable[];
}

export interface CloudRepoSharedEnvFilePayload {
  relativePath: string;
  content: string;
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

function buildEnvVarRowsFromVariables(variables: readonly EnvFileVariable[]): CloudRepoEnvVarRow[] {
  return variables.map((row) => ({
    id: createRowId(),
    key: row.key,
    value: row.value,
  }));
}

function buildSharedEnvFiles(savedConfig: CloudRepoConfig | null | undefined): CloudRepoSharedEnvFile[] {
  return (savedConfig?.trackedFiles ?? [])
    .filter((file) => typeof file.content === "string")
    .map((file) => {
      const originalContent = file.content ?? "";
      const originalVariables = parseEnvFileVariables(originalContent);
      return {
        id: createRowId(),
        relativePath: file.relativePath,
        rows: buildEnvVarRowsFromVariables(originalVariables),
        originalContent,
        originalVariables,
      };
    });
}

function normalizeSharedEnvFilePath(relativePath: string): string {
  return relativePath.trim().replaceAll("\\", "/");
}

function normalizeSharedEnvFiles(files: readonly CloudRepoSharedEnvFile[]): CloudRepoSharedEnvFile[] {
  return files
    .map((file) => ({
      ...file,
      relativePath: normalizeSharedEnvFilePath(file.relativePath),
      rows: file.rows.filter((row) => row.key.trim().length > 0),
    }))
    .filter((file) => file.relativePath.length > 0);
}

function buildSharedEnvFilePayloads(
  files: readonly CloudRepoSharedEnvFile[],
): CloudRepoSharedEnvFilePayload[] {
  return normalizeSharedEnvFiles(files).map((file) => ({
    relativePath: file.relativePath,
    content: serializeEnvFileVariablesPreservingOriginal(
      file.rows,
      file.originalVariables,
      file.originalContent,
    ),
  }));
}

function sharedEnvFilesEqual(
  left: readonly CloudRepoSharedEnvFile[],
  right: readonly CloudRepoSharedEnvFile[],
): boolean {
  const leftNormalized = normalizeSharedEnvFiles(left);
  const rightNormalized = normalizeSharedEnvFiles(right);
  if (leftNormalized.length !== rightNormalized.length) {
    return false;
  }
  return leftNormalized.every((leftFile, index) => {
    const rightFile = rightNormalized[index];
    return rightFile?.relativePath === leftFile.relativePath
      && envFileVariablesEqual(leftFile.rows, rightFile.rows);
  });
}

function nextDefaultSharedEnvFilePath(files: readonly CloudRepoSharedEnvFile[]): string {
  const existing = new Set(files.map((file) => normalizeSharedEnvFilePath(file.relativePath)));
  if (!existing.has(".env.shared")) {
    return ".env.shared";
  }
  for (let index = 2; index < 100; index += 1) {
    const candidate = `.env.shared.${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return ".env.shared";
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
    envVarRows: buildEnvVarRows(initialDraftState.draft.envVars),
    sharedEnvFiles: buildSharedEnvFiles(savedConfig),
    revertSharedEnvFiles: buildSharedEnvFiles(savedConfig),
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
  const sharedEnvFilesDirty = !sharedEnvFilesEqual(
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
      envVarRows: buildEnvVarRows(initialDraftState.draft.envVars),
      sharedEnvFiles: buildSharedEnvFiles(savedConfig),
      revertSharedEnvFiles: buildSharedEnvFiles(savedConfig),
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
        {
          id: createRowId(),
          relativePath: nextDefaultSharedEnvFilePath(current.sharedEnvFiles),
          rows: [{ id: createRowId(), key: "", value: "" }],
          originalContent: null,
          originalVariables: [],
        },
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
      envVarRows: buildEnvVarRows(current.draftState.revertDraft.envVars),
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
      envVarRows: buildEnvVarRows(nextState.draft.envVars),
      sharedEnvFiles: buildSharedEnvFiles(nextSavedConfig),
      revertSharedEnvFiles: buildSharedEnvFiles(nextSavedConfig),
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
    sharedEnvFilePayloads: buildSharedEnvFilePayloads(state.sharedEnvFiles),
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
