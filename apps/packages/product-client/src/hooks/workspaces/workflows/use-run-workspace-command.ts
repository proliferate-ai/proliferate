import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { useTerminalsQuery } from "@anyharness/sdk-react";
import { useRepositories } from "@proliferate/cloud-sdk-react";
import { useTerminalActions } from "#product/hooks/terminals/workflows/use-terminal-actions";
import { useWorkspaceRuntimeBlock } from "#product/hooks/workspaces/derived/use-workspace-runtime-block";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import {
  findLiveSetupTerminalId,
  findReusableRunTerminalId,
} from "#product/lib/domain/terminals/run-terminal";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import { buildSettingsHref } from "#product/lib/domain/settings/navigation";
import { useRepoPreferencesStore } from "#product/stores/preferences/repo-preferences-store";
import { useToastStore } from "#product/stores/toast/toast-store";

interface UseRunWorkspaceCommandArgs {
  selectedWorkspaceId: string | null;
  selectedWorkspace: Workspace | undefined;
  selectedRepoRoot: RepoRoot | undefined;
  selectedCloudWorkspace: CloudWorkspaceSummary | undefined;
  isRuntimeReady: boolean;
  openTerminalPanel: (terminalId?: string) => boolean;
}

export function useRunWorkspaceCommand({
  selectedWorkspaceId,
  selectedWorkspace,
  selectedRepoRoot,
  selectedCloudWorkspace,
  isRuntimeReady,
  openTerminalPanel,
}: UseRunWorkspaceCommandArgs) {
  // Owns the workspace Run command action exposed by the shell chrome. Terminal
  // record creation remains delegated to terminal workflow hooks.
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.show);
  const showErrorToast = useToastStore((state) => state.showError);
  const { createRunTab } = useTerminalActions();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const [isLaunching, setIsLaunching] = useState(false);
  // Ref guards same-tick re-entry; state drives the header button spinner.
  const isLaunchingRef = useRef(false);

  const workspaceId = selectedWorkspaceId;
  const isCloudWorkspace = parseCloudWorkspaceSyntheticId(workspaceId) !== null;
  const gitOwner = isCloudWorkspace
    ? selectedCloudWorkspace?.repo?.owner.trim() ?? ""
    : selectedRepoRoot?.remoteOwner?.trim() ?? "";
  const gitRepoName = isCloudWorkspace
    ? selectedCloudWorkspace?.repo?.name.trim() ?? ""
    : selectedRepoRoot?.remoteRepoName?.trim() ?? "";
  const terminalsQuery = useTerminalsQuery({
    workspaceId,
    enabled: Boolean(workspaceId && isRuntimeReady),
  });
  const { activeRunTerminalId, liveSetupTerminalId } = useMemo(() => {
    if (!workspaceId) {
      return { activeRunTerminalId: null, liveSetupTerminalId: null };
    }
    const candidates = (terminalsQuery.data ?? []).map((record) => ({ ...record, workspaceId }));
    return {
      activeRunTerminalId: findReusableRunTerminalId(candidates, workspaceId),
      liveSetupTerminalId: findLiveSetupTerminalId(candidates, workspaceId),
    };
  }, [terminalsQuery.data, workspaceId]);
  const localSourceRoot = selectedRepoRoot?.path?.trim()
    || selectedWorkspace?.path?.trim()
    || "";
  const localRunCommand = useRepoPreferencesStore((state) =>
    localSourceRoot ? state.repoConfigs[localSourceRoot]?.runCommand ?? "" : "",
  );
  const repoConfigsQuery = useRepositories(isCloudWorkspace && selectedCloudWorkspace !== undefined);
  const cloudEnvironment = useMemo(() => {
    const repo = repoConfigsQuery.data?.repositories.find((candidate) =>
      candidate.gitProvider === "github"
      && candidate.gitOwner === gitOwner
      && candidate.gitRepoName === gitRepoName
    );
    return repo?.environments.find((environment) => environment.kind === "cloud") ?? null;
  }, [gitOwner, gitRepoName, repoConfigsQuery.data?.repositories]);

  const runCommand = isCloudWorkspace
    ? cloudEnvironment?.runCommand ?? ""
    : localRunCommand;
  // The run command is unknown while the cloud repo config is in flight, so
  // the label must not claim a Show target it may have to retract.
  const runCommandSettled = !isCloudWorkspace
    || (!repoConfigsQuery.isLoading && !repoConfigsQuery.error);
  // A live run terminal always wins; the setup terminal stands in only when
  // no run command is configured, so "Run" can still launch one that is.
  const revealTerminalId = activeRunTerminalId
    ?? (runCommandSettled && !runCommand.trim() ? liveSetupTerminalId : null);
  const runtimeBlockedReason = workspaceId
    ? getWorkspaceRuntimeBlockReason(workspaceId)
    : null;

  // The run command is edited on the repo Actions pane, not the Configure pane.
  const runCommandSettingsHref = useMemo(() => {
    if (isCloudWorkspace && gitOwner && gitRepoName) {
      return buildSettingsHref({
        section: "repo-actions",
        focus: { cloudRepoOwner: gitOwner, cloudRepoName: gitRepoName },
      });
    }
    return buildSettingsHref({
      section: "repo-actions",
      repo: localSourceRoot || null,
    });
  }, [gitOwner, gitRepoName, isCloudWorkspace, localSourceRoot]);

  const handleRun = useCallback(async function handleRun() {
    if (isLaunchingRef.current) {
      return;
    }

    if (!workspaceId) {
      return;
    }

    // Revealing an existing terminal is synchronous. Routing it through the
    // launch path would re-list terminals for an id we already hold and flash
    // the header button through a ~30ms loading state on every click.
    if (revealTerminalId) {
      openTerminalPanel(revealTerminalId);
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

    if (isCloudWorkspace && repoConfigsQuery.isLoading) {
      showToast("Cloud run command is still loading.");
      return;
    }

    if (isCloudWorkspace && repoConfigsQuery.error) {
      showToast("Failed to load the cloud run command.");
      return;
    }

    if (!runCommand.trim()) {
      showToast("Configure a Run command for this repository first.");
      navigate(runCommandSettingsHref);
      return;
    }

    isLaunchingRef.current = true;
    setIsLaunching(true);
    try {
      const terminalId = await createRunTab(workspaceId, runCommand);
      openTerminalPanel(terminalId);
    } catch (error) {
      // Names the command that did not run: it comes from repo settings, so the
      // user may not have it memorized, and knowing which one failed is what
      // tells them whether to fix the config or just try again.
      showErrorToast({
        headline: "Run command not started",
        consequence: `Nothing ran. \`${runCommand.trim()}\` did not start and no terminal was opened.`,
        cause: error instanceof Error ? error.message : String(error),
        retry: () => void handleRun(),
      });
    } finally {
      isLaunchingRef.current = false;
      setIsLaunching(false);
    }
  }, [
    createRunTab,
    getWorkspaceRuntimeBlockReason,
    isCloudWorkspace,
    isRuntimeReady,
    navigate,
    openTerminalPanel,
    repoConfigsQuery.error,
    repoConfigsQuery.isLoading,
    revealTerminalId,
    runCommand,
    runCommandSettingsHref,
    selectedCloudWorkspace,
    showErrorToast,
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
    if (isCloudWorkspace && repoConfigsQuery.isLoading) {
      return "Cloud run command is still loading.";
    }
    if (isCloudWorkspace && repoConfigsQuery.error) {
      return "Failed to load the cloud run command.";
    }
    return null;
  })();
  const canRun = disabledReason === null;

  return {
    canRun,
    disabledReason,
    isLaunching,
    runLabel: revealTerminalId ? "Show Run" : "Run",
    runTitle: activeRunTerminalId
      ? "Show active Run terminal"
      : revealTerminalId
        ? "Show setup terminal"
        : "Run workspace command",
    onRun: handleRun,
  };
}
