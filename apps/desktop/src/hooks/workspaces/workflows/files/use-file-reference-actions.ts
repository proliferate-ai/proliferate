import { useCallback, useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useOpenInDefaultEditor } from "@/hooks/editor/workflows/use-open-in-default-editor";
import { useFuzzyFileResolver } from "@/hooks/workspaces/workflows/files/use-fuzzy-file-resolver";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import { useWorkspacePath } from "@/providers/WorkspacePathProvider";
import { resolveFileReference } from "@/lib/domain/files/path-references";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import { fileViewerTarget } from "@/lib/domain/workspaces/viewer/viewer-target";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";

interface UseFileReferenceActionsInput {
  rawPath: string;
  workspacePath?: string | null;
}

export function useFileReferenceActions({
  rawPath,
  workspacePath,
}: UseFileReferenceActionsInput) {
  const host = useProductHost();
  const files = host.desktop?.files ?? null;
  const openTarget = useWorkspaceViewerTabsStore((state) => state.openTarget);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { activateViewerTarget } = useWorkspaceShellActivation();
  const {
    defaultTarget: defaultOpenTarget,
    openInDefaultEditor,
    targets,
  } = useOpenInDefaultEditor();
  const { workspacePath: workspaceRoot, resolveAbsolute } = useWorkspacePath();
  const fuzzyResolveFilePath = useFuzzyFileResolver();

  const reference = useMemo(() => resolveFileReference({
    rawPath,
    workspaceRoot,
    resolveAbsolute,
    workspacePathOverride: workspacePath,
  }), [rawPath, resolveAbsolute, workspacePath, workspaceRoot]);

  const canOpenInSidebar = Boolean(reference.workspacePath);
  const canOpenExternal = Boolean(reference.absolutePath);
  const openTargets = useMemo(
    () => targets.filter((target) => target.kind !== "copy"),
    [targets],
  );

  const copyPath = useCallback(async () => {
    await host.clipboard.writeText(reference.absolutePath ?? reference.path);
  }, [host.clipboard, reference.absolutePath, reference.path]);

  const openInSidebar = useCallback(async () => {
    if (!reference.workspacePath) {
      return;
    }
    const { workspaceUiKey, materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
      selectedLogicalWorkspaceId,
      materializedWorkspaceId: selectedWorkspaceId,
    });
    const openViewer = (path: string) => {
      const target = fileViewerTarget(path);
      openTarget(target);
      if (materializedWorkspaceId) {
        activateViewerTarget({
          workspaceId: materializedWorkspaceId,
          shellWorkspaceId: workspaceUiKey,
          target,
          mode: "open-or-focus",
        });
      }
    };
    // Open optimistically so the common (correct-path) case has zero latency.
    // Then, best-effort and non-blocking, correct a partial/abbreviated path
    // and re-open if it actually pointed elsewhere (the viewer would otherwise
    // just show "file not found").
    openViewer(reference.workspacePath);
    const corrected = await fuzzyResolveFilePath({
      workspacePath: reference.workspacePath,
      materializedWorkspaceId,
    });
    if (corrected && corrected !== reference.workspacePath) {
      openViewer(corrected);
    }
  }, [
    activateViewerTarget,
    fuzzyResolveFilePath,
    openTarget,
    reference.workspacePath,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  ]);

  const openDefault = useCallback(async () => {
    if (!reference.absolutePath) {
      return;
    }
    await openInDefaultEditor(reference.absolutePath);
  }, [openInDefaultEditor, reference.absolutePath]);

  const reveal = useCallback(async () => {
    if (!reference.absolutePath) {
      return;
    }
    if (!files) {
      throw new Error("Local file access is not available.");
    }
    await files.reveal(reference.absolutePath);
  }, [files, reference.absolutePath]);

  const openPrimary = useCallback(async () => {
    // Directories open in Finder; the sidebar viewer only renders files.
    if (reference.absolutePath && files && await files.isDirectory(reference.absolutePath)) {
      await reveal();
      return;
    }
    if (reference.workspacePath) {
      await openInSidebar();
      return;
    }
    if (reference.absolutePath) {
      await reveal();
    }
  }, [files, openInSidebar, reference.absolutePath, reference.workspacePath, reveal]);

  const openWithTarget = useCallback(async (targetId: string) => {
    if (!reference.absolutePath) {
      return;
    }
    if (!files) {
      throw new Error("Local file access is not available.");
    }
    await files.openTarget(targetId, reference.absolutePath);
  }, [files, reference.absolutePath]);

  return {
    reference,
    openTargets,
    defaultOpenTarget,
    canOpenInSidebar,
    canOpenExternal,
    copyPath,
    openInSidebar,
    openDefault,
    openPrimary,
    openWithTarget,
    reveal,
  };
}
