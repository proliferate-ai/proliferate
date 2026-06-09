import { useMemo } from "react";
import type { RepoRoot, SetupScriptExecution, Workspace } from "@anyharness/sdk";
import { useSetupStatusQuery } from "@anyharness/sdk-react";
import { buildWorkspaceArrivalViewModel } from "@/lib/domain/workspaces/creation/arrival";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/derived/use-hot-paint-gate";

const EMPTY_WORKSPACES: Workspace[] = [];

function repoNameFromRoot(repoRoot: RepoRoot | null): string | null {
  return repoRoot?.remoteRepoName?.trim()
    || repoRoot?.displayName?.trim()
    || repoRoot?.path.split("/").filter(Boolean).pop()
    || null;
}

// Owns the read-only arrival banner state for a newly materialized workspace.
// Actions for this banner live in workspaces/workflows.
export function useWorkspaceArrivalState(): {
  workspacePath: string | null;
  sourceRepoRootPath: string | null;
  setupTerminalId: string | null;
  viewModel: ReturnType<typeof buildWorkspaceArrivalViewModel> | null;
} {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const workspaceArrivalEvent = useSessionSelectionStore((state) => state.workspaceArrivalEvent);
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;

  const workspace = useMemo(
    () => workspaces.find((candidate) => candidate.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const repoRoot = useMemo(
    () => workspace
      ? workspaceCollections?.repoRoots.find((candidate) => candidate.id === workspace.repoRootId)
        ?? null
      : null,
    [workspace, workspaceCollections?.repoRoots],
  );
  const sourceRepoRootPath = repoRoot?.path?.trim()
    || workspace?.path?.trim()
    || null;
  const configuredSetupScript = useRepoPreferencesStore((state) => {
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
      && !hotPaintPending
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
      setupTerminalId: liveSetupStatus?.terminalId ?? null,
      repoName: repoNameFromRoot(repoRoot),
    });
  }, [configuredSetupScript, liveSetupStatus, repoRoot, workspace, workspaceArrivalEvent]);

  return {
    workspacePath: workspace?.path ?? null,
    sourceRepoRootPath,
    setupTerminalId: liveSetupStatus?.terminalId ?? null,
    viewModel,
  };
}
