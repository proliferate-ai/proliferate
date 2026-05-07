import { useCallback, useMemo } from "react";
import type { RuntimeInputSyncStatus } from "@/lib/domain/cloud/runtime-input-sync";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { cloudRepositoryKey, isCloudRepository } from "@/lib/domain/settings/repositories";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useCloudCredentials } from "@/hooks/cloud/use-cloud-credentials";
import { useCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";

const EMPTY_REPOSITORIES: SettingsRepositoryEntry[] = [];

export interface RuntimeInputSyncSummaryRow {
  id: string;
  label: string;
  description: string;
  status: RuntimeInputSyncStatus;
}

function summarizeCredentialRows(
  credentialStatuses: ReturnType<typeof useCloudCredentials>["data"],
): RuntimeInputSyncSummaryRow {
  const statuses = credentialStatuses ?? [];
  const syncedCount = statuses.filter((status) => status.synced).length;
  const localCount = statuses.filter((status) => status.localDetected).length;
  const status: RuntimeInputSyncStatus = syncedCount > 0
    ? "synced_to_cloud"
    : localCount > 0
      ? "local_only"
      : "not_configured";

  return {
    id: "credentials",
    label: "Agent credentials",
    description: syncedCount > 0
      ? `${syncedCount} credential source${syncedCount === 1 ? "" : "s"} synced to cloud.`
      : localCount > 0
        ? `${localCount} local credential source${localCount === 1 ? "" : "s"} can sync to cloud.`
        : "No supported local agent credentials detected.",
    status,
  };
}

function summarizeRepoRows(
  repositories: SettingsRepositoryEntry[],
  repoConfigs: ReturnType<typeof useCloudRepoConfigs>["data"],
): RuntimeInputSyncSummaryRow {
  const cloudRepositories = repositories.filter(isCloudRepository);
  const configuredKeys = new Set(
    (repoConfigs?.configs ?? [])
      .filter((config) => config.configured)
      .map((config) => cloudRepositoryKey(config.gitOwner, config.gitRepoName)),
  );
  const configuredLocalCount = cloudRepositories.filter((repository) =>
    configuredKeys.has(cloudRepositoryKey(repository.gitOwner, repository.gitRepoName))
  ).length;

  return {
    id: "repo-files",
    label: "Repo tracked files",
    description: configuredLocalCount > 0
      ? `${configuredLocalCount} repo${configuredLocalCount === 1 ? " has" : "s have"} tracked files saved for cloud; local edits resync from repo settings.`
      : "Configure tracked files from each repo settings page.",
    status: configuredLocalCount > 0 ? "manual_sync" : "not_configured",
  };
}

export function useRuntimeInputSyncSummary(
  repositories: SettingsRepositoryEntry[] = EMPTY_REPOSITORIES,
) {
  const cloudRuntimeInputSyncEnabled = useUserPreferencesStore(
    (state) => state.cloudRuntimeInputSyncEnabled,
  );
  const setPreference = useUserPreferencesStore((state) => state.set);
  const credentials = useCloudCredentials();
  const repoConfigs = useCloudRepoConfigs();
  const setEnabled = useCallback((enabled: boolean) => {
    setPreference("cloudRuntimeInputSyncEnabled", enabled);
    trackProductEvent("runtime_input_sync_toggled", { enabled });
  }, [setPreference]);

  const rows = useMemo(() => [
    summarizeCredentialRows(credentials.data),
    summarizeRepoRows(repositories, repoConfigs.data),
  ], [credentials.data, repoConfigs.data, repositories]);

  return {
    enabled: cloudRuntimeInputSyncEnabled,
    setEnabled,
    rows,
  };
}
