import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCloudWorkspaceActions } from "@/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useWorkspaceSelection } from "@/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useWorkspaceActivationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { targetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import type { AutomationRunRecord } from "@/lib/domain/automations/run/ui-records";
import { useToastStore } from "@/stores/toast/toast-store";

export function useAutomationRunOpenActions(runById: Map<string, AutomationRunRecord>) {
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.show);
  const { selectWorkspace } = useWorkspaceSelection();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const { refreshCloudWorkspace } = useCloudWorkspaceActions();
  const { refetch: refetchWorkspaces } = useWorkspaces();
  const [pendingCloudWorkspaceId, setPendingCloudWorkspaceId] = useState<string | null>(null);

  const openCloudWorkspace = useCallback(async (run: AutomationRunRecord) => {
    const cloudWorkspaceId = run.cloudWorkspaceId;
    if (!cloudWorkspaceId) {
      return;
    }
    setPendingCloudWorkspaceId(cloudWorkspaceId);
    try {
      const workspace = await refreshCloudWorkspace(cloudWorkspaceId);
      const workspaceId = cloudWorkspaceSyntheticId(workspace.id);
      navigate("/");
      if (run.anyharnessSessionId) {
        const result = await openWorkspaceSession({
          workspaceId,
          sessionId: run.anyharnessSessionId,
        });
        if (result.result === "stale") {
          showToast("Workspace selection changed before the automation session opened.");
        }
        return;
      }
      await selectWorkspace(workspaceId, { force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open workspace.";
      showToast(message);
    } finally {
      setPendingCloudWorkspaceId(null);
    }
  }, [navigate, openWorkspaceSession, refreshCloudWorkspace, selectWorkspace, showToast]);

  const openLocalWorkspace = useCallback(async (run: AutomationRunRecord) => {
    if (!run.anyharnessWorkspaceId) {
      return;
    }
    const targetKind = run.targetKindSnapshot ?? run.cloudTargetKindSnapshot;
    const targetId = run.targetIdSnapshot ?? run.cloudTargetIdSnapshot;
    const workspaceId = targetKind === "ssh" && targetId
      ? targetWorkspaceSyntheticId(targetId, run.anyharnessWorkspaceId)
      : run.anyharnessWorkspaceId;
    try {
      await refetchWorkspaces();
      navigate("/");
      if (run.anyharnessSessionId) {
        const result = await openWorkspaceSession({
          workspaceId,
          sessionId: run.anyharnessSessionId,
        });
        if (result.result === "stale") {
          showToast("Workspace selection changed before the automation session opened.");
        }
        return;
      }
      await selectWorkspace(workspaceId, { force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open workspace.";
      showToast(message);
    }
  }, [navigate, openWorkspaceSession, refetchWorkspaces, selectWorkspace, showToast]);

  const openRun = useCallback((runId: string) => {
    const run = runById.get(runId);
    if (!run) {
      return;
    }
    const targetKind = run.targetKindSnapshot ?? run.cloudTargetKindSnapshot;
    const targetId = run.targetIdSnapshot ?? run.cloudTargetIdSnapshot;
    if (targetKind === "ssh" && targetId && run.anyharnessWorkspaceId) {
      void openLocalWorkspace(run);
      return;
    }
    if (run.cloudWorkspaceId) {
      void openCloudWorkspace(run);
      return;
    }
    if (run.anyharnessWorkspaceId) {
      void openLocalWorkspace(run);
    }
  }, [openCloudWorkspace, openLocalWorkspace, runById]);

  return {
    openRun,
    pendingCloudWorkspaceId,
  };
}
