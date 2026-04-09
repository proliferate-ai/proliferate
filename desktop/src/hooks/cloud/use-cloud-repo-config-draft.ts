import { useCallback, useMemo, useState } from "react";
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
}

export function useCloudRepoConfigDraft({
  savedConfig,
  localSetupScript,
}: UseCloudRepoConfigDraftArgs) {
  const [envVarRows, setEnvVarRows] = useState<CloudRepoEnvVarRow[]>(() =>
    buildEnvVarRows(savedConfig?.envVars ?? {}),
  );
  const [trackedFilePaths, setTrackedFilePaths] = useState<string[]>(() =>
    savedConfig?.trackedFiles.map((file) => file.relativePath) ?? [],
  );
  const [setupScript, setSetupScript] = useState(
    () => savedConfig?.setupScript ?? localSetupScript,
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
    setTrackedFilePaths((current) => {
      if (current.includes(normalizedPath)) {
        return current;
      }
      added = true;
      return [...current, normalizedPath];
    });
    return added;
  }, []);

  const removeTrackedFile = useCallback((relativePath: string) => {
    setTrackedFilePaths((current) => current.filter((path) => path !== relativePath));
  }, []);

  return {
    envVarRows,
    envVars,
    trackedFilePaths,
    setupScript,
    setSetupScript,
    addEnvVarRow,
    updateEnvVarRow,
    removeEnvVarRow,
    addTrackedFile,
    removeTrackedFile,
  };
}
