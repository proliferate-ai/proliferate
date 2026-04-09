import { useEffect, useMemo } from "react";
import type { Workspace } from "@anyharness/sdk";
import { SHORTCUTS } from "@/config/shortcuts";
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
import { isUsableWorkspace } from "@/lib/domain/workspaces/usability";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

function getRepoForSelectedWorkspace(
  selectedWorkspaceId: string | null,
  workspaces: Workspace[],
) {
  if (!selectedWorkspaceId) return null;

  const selectedWs = workspaces.find((w) => w.id === selectedWorkspaceId);
  if (!selectedWs) return null;

  const repoWs = workspaces.find(
    (w) =>
      w.kind === "repo"
      && !isCloudWorkspaceId(w.id)
      && localWorkspaceGroupKey(w) === localWorkspaceGroupKey(selectedWs),
  );

  return { selectedWs, repoWs: repoWs ?? null };
}

export function useGlobalShortcuts(): void {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? [];
  const {
    createLocalWorkspaceAndEnter,
    isCreatingLocalWorkspace,
    createWorktreeAndEnter,
    isCreatingWorktreeWorkspace,
  } = useWorkspaceEntryActions();
  const { selectWorkspace } = useWorkspaceSelection();
  const { addRepoFromPicker } = useAddRepo();
  const showToast = useToastStore((state) => state.show);

  // Flat ordered workspace IDs matching sidebar order (grouped by repo, then by update time)
  const orderedWorkspaceIds = useMemo(() => {
    const entries = buildSidebarWorkspaceEntries(workspaces, []);
    const groups = groupSidebarEntries(entries);
    return groups.flatMap((group) =>
      group.entries
        .filter((entry) => entry.source === "cloud" || isUsableWorkspace(entry.workspace))
        .map((entry) => entry.id)
    );
  }, [workspaces]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      // Cmd+Option+1-9 → switch workspace by sidebar index
      // Use e.code (Digit1–Digit9) for reliability across keyboard layouts
      if (e.altKey && !e.shiftKey && e.code.startsWith("Digit")) {
        const digit = e.code.slice(5);
        if (digit >= "1" && digit <= "9") {
          e.preventDefault();
          const idx = digit === "9"
            ? orderedWorkspaceIds.length - 1
            : parseInt(digit, 10) - 1;
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
          return;
        }
      }

      if (e.altKey) return;

      const key = e.key.toLowerCase();

      // --- Workspace commands: fire from any focus context (including text inputs) ---

      // Cmd+Shift+N → new local workspace
      if (key === SHORTCUTS.newLocal.key && e.shiftKey) {
        e.preventDefault();
        if (isCreatingLocalWorkspace) return;
        const ctx = getRepoForSelectedWorkspace(selectedWorkspaceId, workspaces);
        if (!ctx?.repoWs) return;
        const sourceRoot = ctx.repoWs.sourceRepoRootPath;
        void createLocalWorkspaceAndEnter(sourceRoot, { lightweight: true }).catch((error) => {
          showToast(error instanceof Error ? error.message : "Failed to create workspace.");
        });
        return;
      }

      // Bail on shift for remaining shortcuts (they don't use shift)
      if (e.shiftKey) return;

      // Cmd+N → new worktree workspace
      if (key === SHORTCUTS.newWorktree.key) {
        e.preventDefault();
        if (isCreatingWorktreeWorkspace) return;
        const ctx = getRepoForSelectedWorkspace(selectedWorkspaceId, workspaces);
        if (!ctx?.repoWs) return;
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
        return;
      }

      // Cmd+I conflicts with italic in contentEditable — skip text inputs
      const el = e.target as HTMLElement;
      if (
        el.tagName === "INPUT"
        || el.tagName === "TEXTAREA"
        || el.isContentEditable
      ) {
        return;
      }

      // Cmd+I → add repository (opens folder picker)
      if (key === SHORTCUTS.addRepository.key) {
        e.preventDefault();
        void addRepoFromPicker();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    addRepoFromPicker,
    createLocalWorkspaceAndEnter,
    createWorktreeAndEnter,
    isCreatingLocalWorkspace,
    isCreatingWorktreeWorkspace,
    orderedWorkspaceIds,
    selectWorkspace,
    selectedWorkspaceId,
    showToast,
    workspaces,
  ]);
}
