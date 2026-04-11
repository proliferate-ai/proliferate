import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Workspace } from "@anyharness/sdk";
import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/use-workspace-entry-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useAddRepo } from "@/hooks/workspaces/use-add-repo";
import { isCloudWorkspaceId } from "@/lib/domain/workspaces/cloud-ids";
import { localWorkspaceGroupKey } from "@/lib/domain/workspaces/collections";
import {
  buildSidebarWorkspaceEntries,
  groupSidebarEntries,
} from "@/lib/domain/workspaces/sidebar";
import {
  isStandardWorkspace,
  isUsableWorkspace,
} from "@/lib/domain/workspaces/usability";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

const EMPTY_WORKSPACES: Workspace[] = [];

function getRepoForSelectedWorkspace(
  selectedWorkspaceId: string | null,
  workspaces: Workspace[],
) {
  if (!selectedWorkspaceId) return null;

  const selectedWs = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  if (!selectedWs || !isStandardWorkspace(selectedWs)) return null;

  const repoWs = workspaces
    .filter(
      (workspace) =>
        !isCloudWorkspaceId(workspace.id)
        && isStandardWorkspace(workspace)
        && localWorkspaceGroupKey(workspace) === localWorkspaceGroupKey(selectedWs),
    )
    .sort((a, b) => {
      if (a.kind === b.kind) {
        return a.id.localeCompare(b.id);
      }
      return a.kind === "local" ? -1 : 1;
    })[0] ?? null;

  return { selectedWs, repoWs: repoWs ?? null };
}

export function useAppShortcuts(): void {
  const navigate = useNavigate();
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
  const {
    createLocalWorkspaceAndEnter,
    isCreatingLocalWorkspace,
    createWorktreeAndEnter,
    isCreatingWorktreeWorkspace,
  } = useWorkspaceEntryActions();
  const { selectWorkspace } = useWorkspaceSelection();
  const { addRepoFromPicker } = useAddRepo();
  const showToast = useToastStore((state) => state.show);

  const orderedWorkspaceIds = useMemo(() => {
    const entries = buildSidebarWorkspaceEntries(workspaces, []);
    const groups = groupSidebarEntries(entries);
    return groups.flatMap((group) =>
      group.entries
        .filter((entry) => entry.source === "cloud" || isUsableWorkspace(entry.workspace))
        .map((entry) => entry.id)
    );
  }, [workspaces]);

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

    const latencyFlowId = startLatencyFlow({
      flowKind: "worktree_enter",
      source: "shortcut",
      targetWorkspaceId: ctx.repoWs.id,
    });
    void createWorktreeAndEnter(ctx.repoWs.id, {
      lightweight: true,
      latencyFlowId,
    }).catch((error) => {
      failLatencyFlow(latencyFlowId, "worktree_enter_failed");
      showToast(error instanceof Error ? error.message : "Failed to create worktree.");
    });
  });

  useShortcutHandler("workspace.add-repository", () => {
    void addRepoFromPicker();
  });
}
