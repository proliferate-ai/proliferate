import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  type OpenTarget,
  useTauriShellActions,
} from "@/hooks/access/tauri/use-shell-actions";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";

interface UseWorkspaceArrivalActionsArgs {
  workspacePath: string | null;
  sourceRepoRootPath: string | null;
}

export function useWorkspaceArrivalActions({
  workspacePath,
  sourceRepoRootPath,
}: UseWorkspaceArrivalActionsArgs) {
  const navigate = useNavigate();
  const {
    listOpenTargets,
    openTarget: execOpenTarget,
  } = useTauriShellActions();
  const showToast = useToastStore((state) => state.show);
  const setWorkspaceArrivalEvent = useSessionSelectionStore((state) => state.setWorkspaceArrivalEvent);
  const [targets, setTargets] = useState<OpenTarget[]>([]);
  const [isLoadingTargets, setIsLoadingTargets] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!workspacePath) {
      setTargets([]);
      setIsLoadingTargets(false);
      return;
    }

    setIsLoadingTargets(true);
    void listOpenTargets("directory")
      .then((nextTargets) => {
        if (cancelled) return;
        setTargets(nextTargets);
      })
      .catch(() => {
        if (cancelled) return;
        setTargets([]);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingTargets(false);
      });

    return () => {
      cancelled = true;
    };
  }, [listOpenTargets, workspacePath]);

  const handleTargetClick = useCallback((target: OpenTarget) => {
    if (!workspacePath) {
      return;
    }

    void execOpenTarget(target.id, workspacePath).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to open workspace: ${message}`);
    });
  }, [execOpenTarget, showToast, workspacePath]);

  const handleOpenRepositorySettings = useCallback(() => {
    navigate(buildSettingsHref({ section: "repo", repo: sourceRepoRootPath }));
  }, [navigate, sourceRepoRootPath]);

  const handleDismiss = useCallback(() => {
    setWorkspaceArrivalEvent(null);
  }, [setWorkspaceArrivalEvent]);

  return {
    targets,
    isLoadingTargets,
    handleTargetClick,
    handleOpenRepositorySettings,
    handleDismiss,
  };
}
