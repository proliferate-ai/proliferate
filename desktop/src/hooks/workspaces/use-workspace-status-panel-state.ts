import { useMemo } from "react";
import { useSetupStatusQuery } from "@anyharness/sdk-react";
import type { CloudWorkspaceStatusScreenModel } from "@/lib/domain/workspaces/cloud-workspace-status";
import {
  buildCloudWorkspaceStatusScreenModel,
  shouldShowCloudWorkspaceStatusScreen,
} from "@/lib/domain/workspaces/cloud-workspace-status";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { summarizeSetupFailure } from "@/lib/domain/workspaces/arrival";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useWorkspaceArrivalState } from "@/hooks/workspaces/use-workspace-arrival-state";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/pending-entry";
import type { WorkspaceArrivalViewModel } from "@/lib/domain/workspaces/arrival";

export type WorkspaceStatusPanelState =
  | {
    kind: "pending";
    entry: PendingWorkspaceEntry;
    badgeLabel: string;
    title: string;
    subtitle: string;
    detail: string | null;
    isFailed: boolean;
  }
  | {
    kind: "cloud-status";
    workspaceId: string;
    model: CloudWorkspaceStatusScreenModel;
  }
  | {
    kind: "arrival";
    viewModel: WorkspaceArrivalViewModel;
    workspacePath: string | null;
    sourceRepoRootPath: string | null;
  }
  | {
    kind: "setup-failure";
    workspaceId: string;
    command: string;
    summary: string;
    detail: string | null;
  };

function buildPendingSubtitle(entry: PendingWorkspaceEntry): string {
  if (entry.stage === "failed") {
    return entry.errorMessage ?? "Workspace setup failed.";
  }

  if (entry.stage === "awaiting-cloud-ready") {
    return "Provisioning cloud workspace...";
  }

  switch (entry.source) {
    case "local-created":
      return "Creating workspace...";
    case "worktree-created":
      return "Creating worktree...";
    case "cloud-created":
      return "Creating cloud workspace...";
    case "cowork-created":
      return "Starting cowork thread...";
  }
}

function buildPendingBadge(entry: PendingWorkspaceEntry): string {
  if (entry.stage === "failed") {
    return "Failed";
  }

  if (entry.stage === "awaiting-cloud-ready" || entry.source === "cloud-created") {
    return "Provisioning";
  }

  return "Setting up";
}

function buildPendingDetail(entry: PendingWorkspaceEntry): string | null {
  return [
    entry.repoLabel,
    entry.baseBranchName ? `from ${entry.baseBranchName}` : null,
  ]
    .filter(Boolean)
    .join(" · ") || null;
}

export function useWorkspaceStatusPanelState(): WorkspaceStatusPanelState | null {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const { data: workspaceCollections } = useWorkspaces();
  const arrival = useWorkspaceArrivalState();
  const dismissedSetupFailures = useWorkspaceUiStore((s) => s.dismissedSetupFailures);
  const selectedWorkspace = workspaceCollections?.workspaces.find(
    (workspace) => workspace.id === selectedWorkspaceId,
  ) ?? null;
  const configuredSetupScript = useRepoPreferencesStore((state) => {
    const sourceRepoRootPath = selectedWorkspace?.sourceRepoRootPath;
    if (!sourceRepoRootPath) {
      return "";
    }
    return state.repoConfigs[sourceRepoRootPath]?.setupScript?.trim() ?? "";
  });

  // Query setup status for the selected workspace. Used to show persistent
  // failure banners on workspace re-entry (after the arrival event is gone).
  const { data: setupStatus } = useSetupStatusQuery({
    workspaceId: selectedWorkspaceId,
    enabled:
      !!selectedWorkspaceId
      && !arrival.viewModel
      && configuredSetupScript.length > 0,
    refetchWhileRunning: false,
  });

  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const selectedCloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
    (workspace) => workspace.id === selectedCloudWorkspaceId,
  ) ?? null;

  return useMemo(() => {
    if (pendingWorkspaceEntry) {
      const shouldUseCloudStatus = pendingWorkspaceEntry.stage === "awaiting-cloud-ready"
        && selectedCloudWorkspace
        && shouldShowCloudWorkspaceStatusScreen(selectedCloudWorkspace);

      if (!shouldUseCloudStatus) {
        return {
          kind: "pending",
          entry: pendingWorkspaceEntry,
          badgeLabel: buildPendingBadge(pendingWorkspaceEntry),
          title: pendingWorkspaceEntry.displayName,
          subtitle: buildPendingSubtitle(pendingWorkspaceEntry),
          detail: buildPendingDetail(pendingWorkspaceEntry),
          isFailed: pendingWorkspaceEntry.stage === "failed",
        };
      }
    }

    if (
      selectedWorkspaceId
      && selectedCloudWorkspace
      && shouldShowCloudWorkspaceStatusScreen(selectedCloudWorkspace)
    ) {
      return {
        kind: "cloud-status",
        workspaceId: selectedWorkspaceId,
        model: buildCloudWorkspaceStatusScreenModel(selectedCloudWorkspace),
      };
    }

    if (arrival.viewModel) {
      return {
        kind: "arrival",
        viewModel: arrival.viewModel,
        workspacePath: arrival.workspacePath,
        sourceRepoRootPath: arrival.sourceRepoRootPath,
      };
    }

    // Persistent setup failure banner: shown on workspace re-entry when the
    // arrival event is gone but the runtime still has a failed setup result
    // and the user hasn't dismissed it yet.
    if (
      selectedWorkspaceId
      && setupStatus?.status === "failed"
      && !dismissedSetupFailures[selectedWorkspaceId]
    ) {
      const fullOutput = `${setupStatus.stderr ?? ""}\n${setupStatus.stdout ?? ""}`.trim();
      return {
        kind: "setup-failure",
        workspaceId: selectedWorkspaceId,
        command: setupStatus.command,
        summary: summarizeSetupFailure({
          command: setupStatus.command,
          status: "failed",
          exitCode: setupStatus.exitCode ?? -1,
          stdout: setupStatus.stdout ?? "",
          stderr: setupStatus.stderr ?? "",
          durationMs: setupStatus.durationMs ?? 0,
        }),
        detail: fullOutput || null,
      };
    }

    return null;
  }, [
    arrival.sourceRepoRootPath,
    arrival.viewModel,
    arrival.workspacePath,
    dismissedSetupFailures,
    pendingWorkspaceEntry,
    selectedCloudWorkspace,
    selectedWorkspace,
    selectedWorkspaceId,
    setupStatus,
  ]);
}
