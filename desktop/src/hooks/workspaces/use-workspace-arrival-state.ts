import { useMemo } from "react";
import type { SetupScriptExecution, Workspace } from "@anyharness/sdk";
import { useSetupStatusQuery } from "@anyharness/sdk-react";
import { buildWorkspaceArrivalViewModel } from "@/lib/domain/workspaces/arrival";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";

const EMPTY_WORKSPACES: Workspace[] = [];

export function useWorkspaceArrivalState(): {
  workspacePath: string | null;
  sourceRepoRootPath: string | null;
  viewModel: ReturnType<typeof buildWorkspaceArrivalViewModel> | null;
} {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const workspaceArrivalEvent = useHarnessStore((state) => state.workspaceArrivalEvent);
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;

  const workspace = useMemo(
    () => workspaces.find((candidate) => candidate.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const configuredSetupScript = useRepoPreferencesStore((state) => {
    const sourceRepoRootPath = workspace?.sourceRepoRootPath;
    if (!sourceRepoRootPath) {
      return "";
    }
    return state.repoConfigs[sourceRepoRootPath]?.setupScript?.trim() ?? "";
  });

  // Poll setup status for freshly created worktrees. The create_worktree
  // endpoint fires setup async and returns null — the frontend discovers
  // running/completed status via this poll. Enabled for any worktree
  // arrival event (source is worktree-created or local-created).
  const isNewWorkspaceArrival = workspaceArrivalEvent?.source === "worktree-created"
    || workspaceArrivalEvent?.source === "local-created";
  const { data: liveSetupStatus } = useSetupStatusQuery({
    workspaceId: workspace?.id ?? null,
    enabled:
      !!workspace
      && !!workspaceArrivalEvent
      && isNewWorkspaceArrival
      && configuredSetupScript.length > 0,
    refetchWhileRunning: true,
  });

  const viewModel = useMemo(() => {
    if (
      !workspace
      || !workspaceArrivalEvent
      || workspaceArrivalEvent.workspaceId !== workspace.id
    ) {
      return null;
    }

    // Overlay live setup status from the poll onto the arrival event.
    // The create_worktree endpoint returns setupScript: null (setup runs
    // async), so the live poll is the only source of setup status.
    let effectiveEvent = workspaceArrivalEvent;
    if (liveSetupStatus) {
      const liveExecution: SetupScriptExecution = {
        command: liveSetupStatus.command,
        status: liveSetupStatus.status,
        exitCode: liveSetupStatus.exitCode ?? 0,
        stdout: liveSetupStatus.stdout ?? "",
        stderr: liveSetupStatus.stderr ?? "",
        durationMs: liveSetupStatus.durationMs ?? 0,
      };
      effectiveEvent = {
        ...workspaceArrivalEvent,
        setupScript: liveExecution,
      };
    }

    return buildWorkspaceArrivalViewModel({
      event: effectiveEvent,
      workspace,
      configuredSetupScript,
    });
  }, [configuredSetupScript, liveSetupStatus, workspace, workspaceArrivalEvent]);

  return {
    workspacePath: workspace?.path ?? null,
    sourceRepoRootPath: workspace?.sourceRepoRootPath ?? null,
    viewModel,
  };
}
