import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAnyHarnessClient,
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
  useStatWorkspaceFileQuery,
} from "@anyharness/sdk-react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useOpenInDefaultEditor } from "#product/hooks/editor/workflows/use-open-in-default-editor";
import { useFuzzyFileResolver } from "#product/hooks/workspaces/workflows/files/use-fuzzy-file-resolver";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import { useWorkspacePath } from "#product/providers/WorkspacePathProvider";
import {
  resolveFileReference,
  resolveFileReferencePrimaryAction,
  resolveWorkspaceStatPathKind,
  type FileReferencePathKind,
} from "#product/lib/domain/files/path-references";
import { resolveSelectedWorkspaceIdentity } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import { fileViewerTarget } from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";

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
  const selectedWorkspaceIdentity = useMemo(
    () => resolveSelectedWorkspaceIdentity({
      selectedLogicalWorkspaceId,
      materializedWorkspaceId: selectedWorkspaceId,
    }),
    [selectedLogicalWorkspaceId, selectedWorkspaceId],
  );
  const materializedWorkspaceId = selectedWorkspaceIdentity.materializedWorkspaceId;
  const workspaceUiKey = selectedWorkspaceIdentity.workspaceUiKey;
  const { workspacePath: workspaceRoot, resolveAbsolute } = useWorkspacePath();
  const anyHarnessWorkspace = useAnyHarnessWorkspaceContext();
  const fuzzyResolveFilePath = useFuzzyFileResolver();

  const reference = useMemo(() => resolveFileReference({
    rawPath,
    workspaceRoot,
    resolveAbsolute,
    workspacePathOverride: workspacePath,
  }), [rawPath, resolveAbsolute, workspacePath, workspaceRoot]);

  const statQuery = useStatWorkspaceFileQuery({
    workspaceId: materializedWorkspaceId,
    path: reference.workspacePath,
    enabled: Boolean(materializedWorkspaceId && reference.workspacePath),
  });
  const [externalPathKind, setExternalPathKind] = useState<FileReferencePathKind | null>(null);
  const [externalPathKindPending, setExternalPathKindPending] = useState(false);
  const [workspaceResolutionFailed, setWorkspaceResolutionFailed] = useState(false);
  const workspacePathKind = resolveWorkspaceStatPathKind(statQuery.data);
  const pathKind = reference.workspacePath ? workspacePathKind : externalPathKind;

  useEffect(() => {
    setWorkspaceResolutionFailed(false);
  }, [materializedWorkspaceId, reference.workspacePath]);

  useEffect(() => {
    let cancelled = false;
    if (reference.workspacePath || !reference.absolutePath || !files) {
      setExternalPathKind(null);
      setExternalPathKindPending(false);
      return;
    }

    setExternalPathKind(null);
    setExternalPathKindPending(true);
    void files.isDirectory(reference.absolutePath).then((isDirectory) => {
      if (!cancelled) {
        setExternalPathKind(isDirectory ? "directory" : "file");
      }
    }).catch(() => {
      if (!cancelled) {
        setExternalPathKind(null);
      }
    }).finally(() => {
      if (!cancelled) {
        setExternalPathKindPending(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [files, reference.absolutePath, reference.workspacePath]);

  const {
    defaultTarget: defaultOpenTarget,
    openInDefaultEditor,
    targets,
  } = useOpenInDefaultEditor(pathKind ?? "file");

  const canOpenInSidebar = pathKind === "file" && Boolean(reference.workspacePath);
  const canOpenExternal = Boolean(files && reference.absolutePath && pathKind);
  const canReveal = Boolean(files && reference.absolutePath);
  const resolvedPrimaryAction = resolveFileReferencePrimaryAction({
    pathKind,
    canOpenViewer: canOpenInSidebar,
    canReveal,
  });
  const canResolvePathKind = Boolean(
    (reference.workspacePath && materializedWorkspaceId)
    || (reference.absolutePath && files),
  );
  const canOpenPrimary = resolvedPrimaryAction !== "unavailable"
    || (pathKind === null && canResolvePathKind && !workspaceResolutionFailed);
  const pathKindPending = externalPathKindPending || statQuery.isFetching;
  const primaryUnavailableReason = pathKindPending
    ? "Checking whether this path is a file or folder…"
    : pathKind === "directory" && !canReveal
      ? "Reveal in Finder is available in the Desktop app."
      : pathKind === "file" && !canOpenInSidebar
        ? "This file is outside the current workspace."
        : pathKind === null && workspaceResolutionFailed
          ? "This path is unavailable."
          : pathKind === null
            ? "Resolve this path in the workspace."
          : null;
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
    materializedWorkspaceId,
    workspaceUiKey,
  ]);

  const statWorkspacePath = useCallback(async (path: string) => {
    if (!materializedWorkspaceId) {
      return null;
    }
    const resolved = await resolveWorkspaceConnectionFromContext(
      anyHarnessWorkspace,
      materializedWorkspaceId,
    );
    const client = getAnyHarnessClient(resolved.connection);
    return client.files.stat(resolved.connection.anyharnessWorkspaceId, path);
  }, [anyHarnessWorkspace, materializedWorkspaceId]);

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
    let resolvedPathKind = pathKind;
    let resolvedWorkspacePath = reference.workspacePath;
    if (!resolvedPathKind && reference.workspacePath && materializedWorkspaceId) {
      const result = await statQuery.refetch();
      resolvedPathKind = resolveWorkspaceStatPathKind(result.data);
      if (!resolvedPathKind) {
        const corrected = await fuzzyResolveFilePath({
          workspacePath: reference.workspacePath,
          materializedWorkspaceId,
        });
        if (corrected) {
          try {
            const correctedStat = await statWorkspacePath(corrected);
            resolvedPathKind = resolveWorkspaceStatPathKind(correctedStat ?? undefined);
            resolvedWorkspacePath = resolvedPathKind ? corrected : null;
          } catch {
            resolvedPathKind = null;
            resolvedWorkspacePath = null;
          }
        }
        if (!resolvedPathKind || !resolvedWorkspacePath) {
          setWorkspaceResolutionFailed(true);
          return "unavailable";
        }
      }
    }
    if (!resolvedPathKind && reference.absolutePath && files) {
      resolvedPathKind = await files.isDirectory(reference.absolutePath)
        ? "directory"
        : "file";
    }

    const action = resolveFileReferencePrimaryAction({
      pathKind: resolvedPathKind,
      canOpenViewer: Boolean(resolvedWorkspacePath),
      canReveal: Boolean(files && reference.absolutePath),
    });
    if (action === "reveal") {
      await reveal();
      return action;
    }
    if (action === "open-viewer") {
      if (resolvedWorkspacePath) {
        const target = fileViewerTarget(resolvedWorkspacePath);
        openTarget(target);
        if (materializedWorkspaceId) {
          activateViewerTarget({
            workspaceId: materializedWorkspaceId,
            shellWorkspaceId: workspaceUiKey,
            target,
            mode: "open-or-focus",
          });
        }
      }
      setWorkspaceResolutionFailed(false);
      return action;
    }
    return action;
  }, [
    files,
    activateViewerTarget,
    fuzzyResolveFilePath,
    materializedWorkspaceId,
    openTarget,
    pathKind,
    reference.absolutePath,
    reference.workspacePath,
    reveal,
    statWorkspacePath,
    statQuery,
    workspaceUiKey,
  ]);

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
    pathKind,
    pathKindPending,
    canOpenInSidebar,
    canOpenExternal,
    canOpenPrimary,
    canReveal,
    primaryUnavailableReason,
    copyPath,
    openInSidebar,
    openDefault,
    openPrimary,
    openWithTarget,
    reveal,
  };
}
