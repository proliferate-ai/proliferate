import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSetupStatusQuery } from "@anyharness/sdk-react";
import type { CloudRepoFileMetadata } from "@/lib/access/cloud/client";
import { useCloudRepoConfig } from "@/hooks/access/cloud/use-cloud-repo-config";
import { useCloudWorkspaceRepoConfigStatus } from "@/hooks/cloud/use-cloud-workspace-repo-config-status";
import { useResyncCloudWorkspaceCredentials } from "@/hooks/cloud/use-resync-cloud-workspace-credentials";
import { useResyncCloudWorkspaceFiles } from "@/hooks/cloud/use-resync-cloud-workspace-files";
import { useRunCloudWorkspaceSetup } from "@/hooks/cloud/use-run-cloud-workspace-setup";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { buildCloudRepoSettingsHref } from "@/lib/domain/settings/navigation";
import {
  buildCloudWorkspacePostReadyLabel,
  buildCloudWorkspaceSetupStatusLabel,
  formatCloudWorkspaceSettingsError,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-settings";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/use-hot-paint-gate";

const EMPTY_ENV_VAR_KEYS: string[] = [];
const EMPTY_TRACKED_FILES: CloudRepoFileMetadata[] = [];

interface CloudWorkspaceSettingsPanelPlaceholderState {
  kind: "placeholder";
}

interface CloudWorkspaceSettingsPanelReadyState {
  kind: "ready";
  repoLabel: string;
  filesOutOfSync: boolean;
  repoFilesAppliedVersion: number;
  currentRepoFilesVersion: number;
  postReadyLabel: string;
  postReadyProgress: string | null;
  setupStatusLabel: string;
  trackedFiles: CloudRepoFileMetadata[];
  envVarKeys: string[];
  setupScript: string;
  errorMessage: string | null;
  isResyncingFiles: boolean;
  isResyncingCredentials: boolean;
  isRunningSetup: boolean;
  canRunSetup: boolean;
  navigateToRepoSettings: () => void;
  onResyncFiles: () => void;
  onResyncCredentials: () => void;
  onRunSetup: () => void;
}

export type CloudWorkspaceSettingsPanelState =
  | CloudWorkspaceSettingsPanelPlaceholderState
  | CloudWorkspaceSettingsPanelReadyState;

export function useCloudWorkspaceSettingsPanelState(): CloudWorkspaceSettingsPanelState {
  const navigate = useNavigate();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();

  const cloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
    (workspace) => workspace.id === cloudWorkspaceId,
  ) ?? null;
  const { data: repoConfig } = useCloudRepoConfig(
    cloudWorkspace?.repo.owner,
    cloudWorkspace?.repo.name,
    !!cloudWorkspace,
  );
  const setupScript = repoConfig?.setupScript?.trim() ?? "";
  const { data: repoConfigStatus } = useCloudWorkspaceRepoConfigStatus(
    cloudWorkspaceId,
    !!cloudWorkspaceId,
  );
  const setupStatus = useSetupStatusQuery({
    workspaceId: selectedWorkspaceId,
    enabled:
      !!selectedWorkspaceId
      && !!cloudWorkspaceId
      && cloudWorkspace?.status === "ready"
      && !hotPaintPending
      && setupScript.length > 0,
    refetchWhileRunning: true,
  });
  const resyncFilesMutation = useResyncCloudWorkspaceFiles(cloudWorkspaceId);
  const resyncCredentialsMutation = useResyncCloudWorkspaceCredentials(cloudWorkspaceId);
  const runSetupMutation = useRunCloudWorkspaceSetup(cloudWorkspaceId);

  if (!cloudWorkspaceId || !cloudWorkspace) {
    return { kind: "placeholder" };
  }

  const navigateToRepoSettings = useCallback(() => {
    navigate(buildCloudRepoSettingsHref(
      cloudWorkspace.repo.owner,
      cloudWorkspace.repo.name,
    ));
  }, [cloudWorkspace.repo.name, cloudWorkspace.repo.owner, navigate]);

  const onResyncFiles = useCallback(() => {
    void resyncFilesMutation.mutateAsync();
  }, [resyncFilesMutation]);

  const onResyncCredentials = useCallback(() => {
    void resyncCredentialsMutation.mutateAsync();
  }, [resyncCredentialsMutation]);

  const onRunSetup = useCallback(() => {
    void runSetupMutation.mutateAsync();
  }, [runSetupMutation]);

  return {
    kind: "ready",
    repoLabel: `${cloudWorkspace.repo.owner}/${cloudWorkspace.repo.name}`,
    filesOutOfSync: repoConfigStatus?.filesOutOfSync ?? false,
    repoFilesAppliedVersion: repoConfigStatus?.repoFilesAppliedVersion ?? 0,
    currentRepoFilesVersion: repoConfigStatus?.currentRepoFilesVersion ?? 0,
    postReadyLabel: buildCloudWorkspacePostReadyLabel(repoConfigStatus?.postReadyPhase),
    postReadyProgress: repoConfigStatus?.postReadyPhase === "applying_files"
      ? `${repoConfigStatus.postReadyFilesApplied}/${repoConfigStatus.postReadyFilesTotal}`
      : null,
    setupStatusLabel: buildCloudWorkspaceSetupStatusLabel(setupStatus.data?.status),
    trackedFiles: repoConfigStatus?.trackedFiles ?? EMPTY_TRACKED_FILES,
    envVarKeys: repoConfigStatus?.envVarKeys ?? EMPTY_ENV_VAR_KEYS,
    setupScript,
    errorMessage: formatCloudWorkspaceSettingsError({
      credentialError: resyncCredentialsMutation.error ?? null,
      fileError: resyncFilesMutation.error ?? null,
      setupError: runSetupMutation.error ?? null,
      lastApplyError: repoConfigStatus?.lastApplyError,
    }),
    isResyncingFiles: resyncFilesMutation.isPending,
    isResyncingCredentials: resyncCredentialsMutation.isPending,
    isRunningSetup: runSetupMutation.isPending,
    canRunSetup: setupScript.trim().length > 0,
    navigateToRepoSettings,
    onResyncFiles,
    onResyncCredentials,
    onRunSetup,
  };
}
