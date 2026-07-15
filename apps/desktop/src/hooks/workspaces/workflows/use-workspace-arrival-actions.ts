import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  type OpenTarget,
} from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";

interface UseWorkspaceArrivalActionsArgs {
  workspacePath: string | null;
  sourceRepoRootPath: string | null;
}

// Owns user actions for the workspace arrival/status panel.
// Read-only panel state lives in workspaces/derived.
export function useWorkspaceArrivalActions({
  workspacePath,
  sourceRepoRootPath,
}: UseWorkspaceArrivalActionsArgs) {
  const navigate = useNavigate();
  const host = useProductHost();
  const files = host.desktop?.files ?? null;
  const showToast = useToastStore((state) => state.show);
  const setWorkspaceArrivalEvent = useSessionSelectionStore((state) => state.setWorkspaceArrivalEvent);
  const [targets, setTargets] = useState<OpenTarget[]>([]);
  const [isLoadingTargets, setIsLoadingTargets] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!workspacePath || !files) {
      setTargets([]);
      setIsLoadingTargets(false);
      return;
    }

    setIsLoadingTargets(true);
    void files.listOpenTargets("directory")
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
  }, [files, workspacePath]);

  const handleTargetClick = useCallback((target: OpenTarget) => {
    if (!workspacePath) {
      return;
    }
    if (target.kind === "copy") {
      void host.clipboard.writeText(workspacePath).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        showToast(`Failed to open workspace: ${message}`);
      });
      return;
    }
    if (!files) {
      showToast("Local file access is not available.");
      return;
    }

    void files.openTarget(target.id, workspacePath).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to open workspace: ${message}`);
    });
  }, [files, host.clipboard, showToast, workspacePath]);

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
