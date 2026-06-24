import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSetupStatusQuery } from "@anyharness/sdk-react";
import type { CloudRepoFileMetadata } from "@/lib/access/cloud/client";
import { useCloudRepoConfig } from "@/hooks/access/cloud/use-cloud-repo-config";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { buildCloudRepoSettingsHref } from "@/lib/domain/settings/navigation";
import {
  buildCloudWorkspacePostReadyLabel,
  buildCloudWorkspaceSetupStatusLabel,
  formatCloudWorkspaceSettingsError,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-settings";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/derived/use-hot-paint-gate";

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
  isRunningSetup: boolean;
  canRunSetup: boolean;
  navigateToRepoSettings: () => void;
  onResyncFiles: () => void;
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

  const navigateToRepoSettings = useCallback(() => {
    if (!cloudWorkspace) {
      return;
    }
    navigate(buildCloudRepoSettingsHref(
      cloudWorkspace.repo.owner,
      cloudWorkspace.repo.name,
    ));
  }, [cloudWorkspace, navigate]);

  const onResyncFiles = useCallback(() => {}, []);
  const onRunSetup = useCallback(() => {}, []);

  if (!cloudWorkspaceId || !cloudWorkspace) {
    return { kind: "placeholder" };
  }

  return {
    kind: "ready",
    repoLabel: `${cloudWorkspace.repo.owner}/${cloudWorkspace.repo.name}`,
    filesOutOfSync: false,
    repoFilesAppliedVersion: repoConfig?.filesVersion ?? 0,
    currentRepoFilesVersion: repoConfig?.filesVersion ?? 0,
    postReadyLabel: buildCloudWorkspacePostReadyLabel(undefined),
    postReadyProgress: null,
    setupStatusLabel: buildCloudWorkspaceSetupStatusLabel(setupStatus.data?.status),
    trackedFiles: repoConfig?.trackedFiles ?? EMPTY_TRACKED_FILES,
    envVarKeys: repoConfig ? Object.keys(repoConfig.envVars).sort() : EMPTY_ENV_VAR_KEYS,
    setupScript,
    errorMessage: formatCloudWorkspaceSettingsError({
      credentialError: null,
      fileError: null,
      setupError: null,
      lastApplyError: null,
    }),
    isResyncingFiles: false,
    isRunningSetup: false,
    canRunSetup: false,
    navigateToRepoSettings,
    onResyncFiles,
    onRunSetup,
  };
}
