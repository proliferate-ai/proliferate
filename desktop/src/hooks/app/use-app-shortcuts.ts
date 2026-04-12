import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Workspace } from "@anyharness/sdk";
import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { useCloudBilling } from "@/hooks/cloud/use-cloud-billing";
import { useCloudRepoConfigs } from "@/hooks/cloud/use-cloud-repo-configs";
import { useCreateCloudWorkspace } from "@/hooks/cloud/use-create-cloud-workspace";
import { useStandardRepoProjection } from "@/hooks/workspaces/use-standard-repo-projection";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/use-workspace-entry-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useAddRepo } from "@/hooks/workspaces/use-add-repo";
import { buildCloudRepoSettingsHref } from "@/lib/domain/settings/navigation";
import {
  buildConfiguredCloudRepoKeys,
  resolveCloudRepoActionState,
} from "@/lib/domain/workspaces/cloud-workspace-creation";
import { getCloudRepoTargetForSelectedWorkspace, getRepoForSelectedWorkspace } from "@/lib/domain/workspaces/selected-repo-target";
import {
  buildSidebarWorkspaceEntries,
  groupSidebarEntries,
} from "@/lib/domain/workspaces/sidebar";
import {
  isUsableWorkspace,
} from "@/lib/domain/workspaces/usability";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

const EMPTY_WORKSPACES: Workspace[] = [];

export function useAppShortcuts(): void {
  const navigate = useNavigate();
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { cloudActive } = useCloudAvailabilityState();
  const { data: billingPlan } = useCloudBilling();
  const {
    data: cloudRepoConfigs,
    isPending: isCloudRepoConfigsPending,
  } = useCloudRepoConfigs(cloudActive);
  const {
    localWorkspaces,
    cloudWorkspaces,
  } = useStandardRepoProjection();
  const workspaces = localWorkspaces ?? EMPTY_WORKSPACES;
  const {
    createLocalWorkspaceAndEnter,
    isCreatingLocalWorkspace,
    createWorktreeAndEnter,
    isCreatingWorktreeWorkspace,
  } = useWorkspaceEntryActions();
  const {
    createCloudWorkspaceAndEnter,
    isCreatingCloudWorkspace,
  } = useCreateCloudWorkspace();
  const { selectWorkspace } = useWorkspaceSelection();
  const { addRepoFromPicker } = useAddRepo();
  const showToast = useToastStore((state) => state.show);
  const configuredCloudRepoKeys = useMemo(
    () => buildConfiguredCloudRepoKeys(cloudRepoConfigs?.configs),
    [cloudRepoConfigs?.configs],
  );
  const cloudRepoConfigsInitialLoading = cloudActive
    && isCloudRepoConfigsPending
    && !cloudRepoConfigs;
  const cloudWorkspaceBlocked = billingPlan?.billingMode === "enforce" && billingPlan.blocked;

  const orderedWorkspaceIds = useMemo(() => {
    const entries = buildSidebarWorkspaceEntries(workspaces, cloudWorkspaces);
    const groups = groupSidebarEntries(entries);
    return groups.flatMap((group) =>
      group.entries
        .filter((entry) => entry.source === "cloud" || isUsableWorkspace(entry.workspace))
        .map((entry) => entry.id)
    );
  }, [cloudWorkspaces, workspaces]);

  useShortcutHandler("app.open-settings", () => {
    navigate("/settings");
  });

  useShortcutHandler("workspace.by-index", ({ digit }) => {
    if (!digit) {
      return false;
    }

    const idx = digit === 9 ? orderedWorkspaceIds.length - 1 : digit - 1;
    const targetId = orderedWorkspaceIds[idx];
    if (targetId) {
      const latencyFlowId = startLatencyFlow({
        flowKind: "workspace_switch",
        source: "shortcut",
        targetWorkspaceId: targetId,
      });
      void selectWorkspace(targetId, { latencyFlowId }).catch(() => {
        failLatencyFlow(latencyFlowId, "workspace_switch_failed");
      });
    }
  });

  useShortcutHandler("workspace.new-local", () => {
    if (isCreatingLocalWorkspace) {
      return;
    }

    const ctx = getRepoForSelectedWorkspace(selectedWorkspaceId, workspaces);
    if (!ctx?.repoWs) {
      return;
    }

    const sourceRoot = ctx.repoWs.sourceRepoRootPath?.trim();
    if (!sourceRoot) {
      return;
    }

    void createLocalWorkspaceAndEnter(sourceRoot, {
      lightweight: true,
    }).catch((error) => {
      showToast(error instanceof Error ? error.message : "Failed to create workspace.");
    });
  });

  useShortcutHandler("workspace.new-worktree", () => {
    if (isCreatingWorktreeWorkspace) {
      return;
    }

    const ctx = getRepoForSelectedWorkspace(selectedWorkspaceId, workspaces);
    if (!ctx?.repoWs) {
      return;
    }

    const repoRootId = ctx.repoWs.repoRootId?.trim();
    if (!repoRootId) {
      return;
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "worktree_enter",
      source: "shortcut",
      targetWorkspaceId: repoRootId,
    });
    void createWorktreeAndEnter({
      repoRootId,
      sourceWorkspaceId: ctx.repoWs.id,
    }, {
      lightweight: true,
      latencyFlowId,
    }).catch((error) => {
      failLatencyFlow(latencyFlowId, "worktree_enter_failed");
      showToast(error instanceof Error ? error.message : "Failed to create worktree.");
    });
  });

  useShortcutHandler("workspace.new-cloud", () => {
    if (isCreatingCloudWorkspace || !cloudActive || cloudWorkspaceBlocked) {
      return;
    }

    const target = getCloudRepoTargetForSelectedWorkspace(
      selectedWorkspaceId,
      workspaces,
      cloudWorkspaces,
    );
    const cloudRepoAction = resolveCloudRepoActionState({
      repoTarget: target,
      configuredRepoKeys: configuredCloudRepoKeys,
      isInitialConfigLoad: cloudRepoConfigsInitialLoading,
    });

    if (!target || cloudRepoAction.kind === "hidden" || cloudRepoAction.kind === "loading") {
      return;
    }
    if (cloudRepoAction.kind === "configure") {
      navigate(buildCloudRepoSettingsHref(target.gitOwner, target.gitRepoName));
      return;
    }

    void createCloudWorkspaceAndEnter(target);
  });

  useShortcutHandler("workspace.add-repository", () => {
    void addRepoFromPicker();
  });
}
