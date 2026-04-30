import { useCallback, useEffect, useMemo, useState } from "react";
import {
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
import type { CloudRepoConfigResponse } from "@/lib/integrations/cloud/client";

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
  const [draftState, setDraftState] = useState<CloudEnvironmentDraftState>(
    () => initialDraftState,
  );
  const [activeSourceKey, setActiveSourceKey] = useState(sourceKey);
  const [envVarRows, setEnvVarRows] = useState<CloudRepoEnvVarRow[]>(() =>
    buildEnvVarRows(initialDraftState.draft.envVars),
  );

  const envVars = useMemo(() => (
    envVarRows.reduce<Record<string, string>>((accumulator, row) => {
      const key = row.key.trim();
      if (!key) {
        return accumulator;
      }
      accumulator[key] = row.value;
      return accumulator;
    }, {})
  ), [envVarRows]);
  const currentDraft = useMemo(
    () => normalizeCloudEnvironmentDraft({
      ...draftState.draft,
      envVars,
    }),
    [draftState.draft, envVars],
  );
  const dirty = isCloudEnvironmentDraftDirty(currentDraft, draftState.baseline);
  const configurable = isCloudEnvironmentDraftConfigurable(currentDraft, draftState.baseline);
  const savePayload = useMemo(
    () => buildCloudEnvironmentSavePayload(currentDraft),
    [currentDraft],
  );

  useEffect(() => {
    const sourceChanged = activeSourceKey !== sourceKey;
    if (!sourceChanged && dirty) {
      return;
    }

    setDraftState(initialDraftState);
    setEnvVarRows(buildEnvVarRows(initialDraftState.draft.envVars));
    setActiveSourceKey(sourceKey);
  }, [activeSourceKey, dirty, initialDraftState, sourceKey]);

  const updateDraft = useCallback((patch: Partial<CloudEnvironmentDraft>) => {
    setDraftState((current) => ({
      ...current,
      draft: normalizeCloudEnvironmentDraft({
        ...current.draft,
        ...patch,
      }),
    }));
  }, []);

  const addEnvVarRow = useCallback(() => {
    setEnvVarRows((current) => [
      ...current,
      { id: createRowId(), key: "", value: "" },
    ]);
  }, []);

  const updateEnvVarRow = useCallback((
    rowId: string,
    patch: Partial<Pick<CloudRepoEnvVarRow, "key" | "value">>,
  ) => {
    setEnvVarRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  }, []);

  const removeEnvVarRow = useCallback((rowId: string) => {
    setEnvVarRows((current) => current.filter((row) => row.id !== rowId));
  }, []);

  const addTrackedFile = useCallback((relativePath: string) => {
    const normalizedPath = relativePath.trim();
    if (!normalizedPath) {
      return false;
    }

    let added = false;
    setDraftState((current) => {
      if (current.draft.trackedFilePaths.includes(normalizedPath)) {
        return current;
      }
      added = true;
      return {
        ...current,
        draft: {
          ...current.draft,
          trackedFilePaths: [...current.draft.trackedFilePaths, normalizedPath],
        },
      };
    });
    return added;
  }, []);

  const removeTrackedFile = useCallback((relativePath: string) => {
    setDraftState((current) => ({
      ...current,
      draft: {
        ...current.draft,
        trackedFilePaths: current.draft.trackedFilePaths.filter((path) => path !== relativePath),
      },
    }));
  }, []);

  const revert = useCallback(() => {
    setDraftState((current) => ({
      ...current,
      draft: current.baseline,
    }));
    setEnvVarRows(buildEnvVarRows(draftState.baseline.envVars));
  }, [draftState.baseline]);

  const disable = useCallback(() => {
    setDraftState((current) => ({
      ...current,
      draft: buildDisabledCloudEnvironmentDraft(),
    }));
    setEnvVarRows([]);
  }, []);

  const resetFromSavedConfig = useCallback((nextSavedConfig: CloudRepoConfigResponse | null | undefined) => {
    const nextState = buildSavedCloudEnvironmentDraftState(nextSavedConfig);
    setDraftState(nextState);
    setEnvVarRows(buildEnvVarRows(nextState.draft.envVars));
  }, []);

  return {
    configured: currentDraft.configured,
    defaultBranch: currentDraft.defaultBranch,
    setDefaultBranch: (defaultBranch: string | null) => updateDraft({ defaultBranch }),
    envVarRows,
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
