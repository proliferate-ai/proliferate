import { useMemo } from "react";
import { useSetupStatusQuery } from "@anyharness/sdk-react";
import type { CloudWorkspaceStatusScreenModel } from "@/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import {
  buildCloudWorkspaceStatusScreenModel,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import { shouldShowCloudWorkspaceStatusScreen } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { summarizeSetupFailure } from "@/lib/domain/workspaces/creation/arrival";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useWorkspaceArrivalState } from "@/hooks/workspaces/use-workspace-arrival-state";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import { resolveWithWorkspaceFallback } from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import type { WorkspaceArrivalViewModel } from "@/lib/domain/workspaces/creation/arrival";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/use-hot-paint-gate";

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
    setupTerminalId: string | null;
  }
  | {
    kind: "setup-failure";
    workspaceUiKey: string;
    materializedWorkspaceId: string;
    command: string;
    summary: string;
    detail: string | null;
    terminalId: string | null;
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
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { workspaceUiKey, materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
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
    workspaceId: materializedWorkspaceId,
    enabled:
      !!materializedWorkspaceId
      && !arrival.viewModel
      && !hotPaintPending
      && configuredSetupScript.length > 0,
    refetchWhileRunning: false,
  });

  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const selectedCloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
    (workspace) => workspace.id === selectedCloudWorkspaceId,
  ) ?? null;

  return useMemo(() => {
    if (pendingWorkspaceEntry) {
      if (pendingWorkspaceEntry.stage !== "failed") {
        return null;
      }

      return {
        kind: "pending",
        entry: pendingWorkspaceEntry,
        badgeLabel: buildPendingBadge(pendingWorkspaceEntry),
        title: pendingWorkspaceEntry.displayName,
        subtitle: buildPendingSubtitle(pendingWorkspaceEntry),
        detail: buildPendingDetail(pendingWorkspaceEntry),
        isFailed: true,
      };
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
        setupTerminalId: arrival.setupTerminalId,
      };
    }

    // Persistent setup failure banner: shown on workspace re-entry when the
    // arrival event is gone but the runtime still has a failed setup result
    // and the user hasn't dismissed it yet.
    if (
      workspaceUiKey
      && materializedWorkspaceId
      && setupStatus?.status === "failed"
      && !resolveWithWorkspaceFallback(
        dismissedSetupFailures,
        workspaceUiKey,
        materializedWorkspaceId,
      ).value
    ) {
      const fullOutput = `${setupStatus.stderr ?? ""}\n${setupStatus.stdout ?? ""}`.trim();
      return {
        kind: "setup-failure",
        workspaceUiKey,
        materializedWorkspaceId,
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
        terminalId: setupStatus.terminalId ?? null,
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
    workspaceUiKey,
    materializedWorkspaceId,
  ]);
}
