import { useCallback } from "react";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { sessionSlotBelongsToWorkspace } from "@/lib/domain/sessions/activity";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

export type CloseActiveWorkspaceTabResult = "closed" | "blocked" | "noop";

function discardDirtyFileTab(isDirty: boolean): boolean {
  if (!isDirty) {
    return true;
  }

  return window.confirm("Discard unsaved changes?");
}

export function useCloseActiveWorkspaceTab() {
  const activeMainTab = useWorkspaceFilesStore((state) => state.activeMainTab);
  const buffersByPath = useWorkspaceFilesStore((state) => state.buffersByPath);
  const closeTab = useWorkspaceFilesStore((state) => state.closeTab);

  const activeSessionId = useHarnessStore((state) => state.activeSessionId);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const sessionSlots = useHarnessStore((state) => state.sessionSlots);
  const showToast = useToastStore((state) => state.show);

  const { dismissSession } = useSessionActions();

  return useCallback((): CloseActiveWorkspaceTabResult => {
    if (activeMainTab.kind === "file") {
      const path = activeMainTab.path;
      const isDirty = buffersByPath[path]?.isDirty ?? false;
      if (!discardDirtyFileTab(isDirty)) {
        return "blocked";
      }

      closeTab(path);
      return "closed";
    }

    if (
      activeSessionId
      && sessionSlotBelongsToWorkspace(sessionSlots[activeSessionId], selectedWorkspaceId)
    ) {
      void dismissSession(activeSessionId).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        showToast(message);
      });
      return "closed";
    }

    return "noop";
  }, [
    activeMainTab,
    activeSessionId,
    buffersByPath,
    closeTab,
    dismissSession,
    selectedWorkspaceId,
    sessionSlots,
    showToast,
  ]);
}
