import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { OpenTarget } from "@/platform/tauri/shell";
import {
  listOpenTargets,
  openTarget as execOpenTarget,
} from "@/platform/tauri/shell";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

interface UseWorkspaceArrivalActionsArgs {
  workspacePath: string | null;
  sourceRepoRootPath: string | null;
}

export function useWorkspaceArrivalActions({
  workspacePath,
  sourceRepoRootPath,
}: UseWorkspaceArrivalActionsArgs) {
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.show);
  const setWorkspaceArrivalEvent = useHarnessStore((state) => state.setWorkspaceArrivalEvent);
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
  }, [workspacePath]);

  const handleTargetClick = useCallback((target: OpenTarget) => {
    if (!workspacePath) {
      return;
    }

    void execOpenTarget(target.id, workspacePath).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to open workspace: ${message}`);
    });
  }, [showToast, workspacePath]);

  const handleOpenRepositorySettings = useCallback(() => {
    const params = new URLSearchParams({ section: "Repositories" });
    if (sourceRepoRootPath) {
      params.set("repo", sourceRepoRootPath);
    }
    navigate(`/settings?${params.toString()}`);
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
