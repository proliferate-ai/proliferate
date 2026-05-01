import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Workspace } from "@anyharness/sdk";
import { useTerminalsQuery } from "@anyharness/sdk-react";
import { useCloudRepoConfig } from "@/hooks/cloud/use-cloud-repo-config";
import { useTerminalActions } from "@/hooks/terminals/use-terminal-actions";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { findReusableRunTerminalId } from "@/lib/domain/terminals/run-terminal";
import type { CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";
import {
  buildCloudRepoSettingsHref,
  buildSettingsHref,
} from "@/lib/domain/settings/navigation";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useToastStore } from "@/stores/toast/toast-store";

interface UseRunWorkspaceCommandArgs {
  selectedWorkspaceId: string | null;
  selectedWorkspace: Workspace | undefined;
  selectedCloudWorkspace: CloudWorkspaceSummary | undefined;
  isRuntimeReady: boolean;
  openTerminalPanel: (terminalId?: string) => boolean;
}

export function useRunWorkspaceCommand({
  selectedWorkspaceId,
  selectedWorkspace,
  selectedCloudWorkspace,
  isRuntimeReady,
  openTerminalPanel,
}: UseRunWorkspaceCommandArgs) {
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.show);
  const { createRunTab } = useTerminalActions();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const [isLaunching, setIsLaunching] = useState(false);
  // Ref guards same-tick re-entry; state drives the header button spinner.
  const isLaunchingRef = useRef(false);

  const workspaceId = selectedWorkspaceId;
  const isCloudWorkspace = parseCloudWorkspaceSyntheticId(workspaceId) !== null;
  const gitOwner = isCloudWorkspace
    ? selectedCloudWorkspace?.repo?.owner.trim() ?? ""
    : selectedWorkspace?.gitOwner?.trim() ?? "";
  const gitRepoName = isCloudWorkspace
    ? selectedCloudWorkspace?.repo?.name.trim() ?? ""
    : selectedWorkspace?.gitRepoName?.trim() ?? "";
  const terminalsQuery = useTerminalsQuery({
    workspaceId,
    enabled: Boolean(workspaceId && isRuntimeReady),
  });
  const activeRunTerminalId = useMemo(() => {
    if (!workspaceId) {
      return null;
    }
    const records = terminalsQuery.data ?? [];
    return findReusableRunTerminalId(
      records.map((record) => ({ ...record, workspaceId })),
      workspaceId,
    );
  }, [terminalsQuery.data, workspaceId]);
  const localSourceRoot = selectedWorkspace?.sourceRepoRootPath?.trim()
    || selectedWorkspace?.path?.trim()
    || "";
  const localRunCommand = useRepoPreferencesStore((state) =>
    localSourceRoot ? state.repoConfigs[localSourceRoot]?.runCommand ?? "" : "",
  );
  const cloudConfigQuery = useCloudRepoConfig(
    gitOwner,
    gitRepoName,
    isCloudWorkspace && selectedCloudWorkspace !== undefined,
  );

  const runCommand = isCloudWorkspace
    ? cloudConfigQuery.data?.runCommand ?? ""
    : localRunCommand;
  const runtimeBlockedReason = workspaceId
    ? getWorkspaceRuntimeBlockReason(workspaceId)
    : null;

  const configureHref = useMemo(() => {
    if (isCloudWorkspace && gitOwner && gitRepoName) {
      return buildCloudRepoSettingsHref(gitOwner, gitRepoName);
    }
    return buildSettingsHref({
      section: "repo",
      repo: localSourceRoot || null,
    });
  }, [gitOwner, gitRepoName, isCloudWorkspace, localSourceRoot]);

  const handleRun = useCallback(async () => {
    if (isLaunchingRef.current) {
      return;
    }

    if (!workspaceId) {
      return;
    }

    if (isCloudWorkspace && !selectedCloudWorkspace) {
      showToast("Cloud workspace metadata is still loading.");
      return;
    }

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }

    if (!isRuntimeReady) {
      showToast("Workspace runtime is not ready yet.");
      return;
    }

    if (isCloudWorkspace && cloudConfigQuery.isLoading) {
      showToast("Cloud run command is still loading.");
      return;
    }

    if (isCloudWorkspace && cloudConfigQuery.error) {
      showToast("Failed to load the cloud run command.");
      return;
    }

    if (!runCommand.trim()) {
      showToast("Configure a Run command for this repository first.");
      navigate(configureHref);
      return;
    }

    isLaunchingRef.current = true;
    setIsLaunching(true);
    try {
      const terminalId = await createRunTab(workspaceId, runCommand);
      openTerminalPanel(terminalId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to start Run command: ${message}`);
    } finally {
      isLaunchingRef.current = false;
      setIsLaunching(false);
    }
  }, [
    cloudConfigQuery.error,
    cloudConfigQuery.isLoading,
    configureHref,
    createRunTab,
    getWorkspaceRuntimeBlockReason,
    isCloudWorkspace,
    isRuntimeReady,
    navigate,
    openTerminalPanel,
    runCommand,
    selectedCloudWorkspace,
    showToast,
    workspaceId,
  ]);

  // Empty commands intentionally keep the button enabled so clicking it can route
  // to the repository settings page where the Run command is configured.
  const disabledReason = (() => {
    if (isLaunching) {
      return "Action already in progress.";
    }
    if (!workspaceId) {
      return "Workspace is still opening.";
    }
    if (runtimeBlockedReason) {
      return runtimeBlockedReason;
    }
    if (!isRuntimeReady) {
      return "Workspace runtime is not ready yet.";
    }
    if (isCloudWorkspace && !selectedCloudWorkspace) {
      return "Cloud workspace metadata is still loading.";
    }
    if (isCloudWorkspace && cloudConfigQuery.isLoading) {
      return "Cloud run command is still loading.";
    }
    if (isCloudWorkspace && cloudConfigQuery.error) {
      return "Failed to load the cloud run command.";
    }
    return null;
  })();
  const canRun = disabledReason === null;

  return {
    canRun,
    disabledReason,
    isLaunching,
    runLabel: activeRunTerminalId ? "Show Run" : "Run",
    runTitle: activeRunTerminalId ? "Show active Run terminal" : "Run workspace command",
    onRun: handleRun,
  };
}
