import { useMemo } from "react";
import type { Workspace } from "@anyharness/sdk";
import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { useStandardRepoProjection } from "@/hooks/workspaces/use-standard-repo-projection";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import {
  buildSidebarWorkspaceEntries,
  groupSidebarEntries,
} from "@/lib/domain/workspaces/sidebar";
import { isUsableWorkspace } from "@/lib/domain/workspaces/usability";
import type { AppCommandActions } from "@/hooks/app/use-app-command-actions";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

const EMPTY_WORKSPACES: Workspace[] = [];

export function useAppShortcuts(actions: AppCommandActions): void {
  const {
    localWorkspaces,
    cloudWorkspaces,
  } = useStandardRepoProjection();
  const workspaces = localWorkspaces ?? EMPTY_WORKSPACES;
  const { selectWorkspace } = useWorkspaceSelection();

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
    actions.openSettings.execute("shortcut");
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
    actions.newLocalWorkspace.execute("shortcut");
  });

  useShortcutHandler("workspace.new-worktree", () => {
    actions.newWorktreeWorkspace.execute("shortcut");
  });

  useShortcutHandler("workspace.new-cloud", () => {
    actions.newCloudWorkspace.execute("shortcut");
  });

  useShortcutHandler("workspace.add-repository", () => {
    actions.addRepository.execute("shortcut");
  });
}
