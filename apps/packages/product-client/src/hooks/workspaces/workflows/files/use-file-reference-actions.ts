import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAnyHarnessClient,
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
  useStatWorkspaceFileQuery,
} from "@anyharness/sdk-react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useOpenInDefaultEditor } from "#product/hooks/editor/workflows/use-open-in-default-editor";
import {
  resolveInspectionPathKind,
  resolveInspectionUnavailableCopy,
  useDesktopPathInspection,
} from "#product/hooks/workspaces/workflows/files/use-desktop-path-inspection";
import { useFuzzyFileResolver } from "#product/hooks/workspaces/workflows/files/use-fuzzy-file-resolver";
import { useHomeRelativeFileReference } from "#product/hooks/workspaces/workflows/files/use-home-relative-file-reference";
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
  const {
    homeDirectory,
    needsHomeDirectory,
    pending: homeDirectoryPending,
    rejected: homeDirectoryRejected,
    resolveHomeDirectory,
  } = useHomeRelativeFileReference(files, rawPath);
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
    homeDirectory,
    workspacePathOverride: workspacePath,
  }), [homeDirectory, rawPath, resolveAbsolute, workspacePath, workspaceRoot]);

  const statQuery = useStatWorkspaceFileQuery({
    workspaceId: materializedWorkspaceId,
    path: reference.workspacePath,
    enabled: Boolean(materializedWorkspaceId && reference.workspacePath),
  });
  const routeRevision = useMemo(() => ({}), [
    files,
    rawPath,
    resolveAbsolute,
    workspacePath,
    workspaceRoot,
  ]);
  const currentRouteRevisionRef = useRef(routeRevision);
  currentRouteRevisionRef.current = routeRevision;
  const [pathResolutionFailed, setPathResolutionFailed] = useState(false);
  const [primaryOpenFailed, setPrimaryOpenFailed] = useState(false);

  const desktopCandidatePath = reference.workspacePath ? null : reference.absolutePath;
  const {
    ensureInspection: ensureDesktopPathInspection,
    state: desktopInspectionState,
  } = useDesktopPathInspection({
    candidatePath: desktopCandidatePath,
    files,
    routeRevision,
  });

  const workspacePathKind = resolveWorkspaceStatPathKind(statQuery.data);
  const externalPathKind = resolveInspectionPathKind(desktopInspectionState);
  const pathKind = reference.workspacePath ? workspacePathKind : externalPathKind;

  useEffect(() => {
    setPathResolutionFailed(false);
    setPrimaryOpenFailed(false);
  }, [materializedWorkspaceId, reference.absolutePath, reference.workspacePath]);

  const {
    defaultTarget: defaultOpenTarget,
    openInDefaultEditor,
    targets,
  } = useOpenInDefaultEditor(pathKind);

  const canOpenInSidebar = pathKind === "file" && Boolean(reference.workspacePath);
  const canOpenExternal = Boolean(files && reference.absolutePath && pathKind);
  const canReveal = Boolean(
    files
    && reference.absolutePath
    && pathKind === "directory",
  );
  const resolvedPrimaryAction = resolveFileReferencePrimaryAction({
    pathKind,
    canOpenViewer: canOpenInSidebar,
    canOpenExternal,
    canReveal,
  });
  const canOpenPrimary = resolvedPrimaryAction !== "unavailable"
    || Boolean(reference.workspacePath && materializedWorkspaceId && pathKind === null);
  const desktopInspectionPending = Boolean(
    files
    && desktopCandidatePath
    && (desktopInspectionState.status === "idle"
      || desktopInspectionState.status === "pending"),
  );
  const homeResolutionPending = Boolean(
    needsHomeDirectory
    && files
    && !homeDirectory
    && !homeDirectoryRejected,
  );
  const pathKindPending = homeDirectoryPending
    || homeResolutionPending
    || desktopInspectionPending
    || statQuery.isFetching;
  const desktopInspectionUnavailableReason = files && desktopCandidatePath
    ? resolveInspectionUnavailableCopy(desktopInspectionState)
    : null;
  const primaryUnavailableReason = pathKindPending
    ? "Checking whether this path is a file or folder…"
    : primaryOpenFailed
      ? "Could not open this path. Click to retry."
      : desktopInspectionUnavailableReason
        ?? (homeDirectoryRejected
          ? "This path is unavailable."
          : pathKind === "directory" && !canReveal
            ? "This path is unavailable."
            : needsHomeDirectory && !files
              ? "This path is unavailable."
              : !reference.workspacePath && reference.absolutePath && !files
                ? "This path is unavailable."
                : pathKind === "file" && !canOpenInSidebar && !canOpenExternal
                  ? "This path is unavailable."
                  : pathKind === null && pathResolutionFailed
                    ? "This path was not found."
                    : pathKind === null
                      ? "This path is unavailable."
                      : null);
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

  const currentNativePathKind = useCallback((
    absolutePath: string,
  ): FileReferencePathKind | null => {
    if (
      currentRouteRevisionRef.current !== routeRevision
      || absolutePath !== reference.absolutePath
      || !files
      || pathKind === null
    ) {
      return null;
    }
    if (reference.workspacePath) {
      return pathKind;
    }
    return desktopInspectionState.status === "settled"
      && desktopInspectionState.inspection.kind === pathKind
      ? pathKind
      : null;
  }, [
    desktopInspectionState,
    files,
    pathKind,
    reference.absolutePath,
    reference.workspacePath,
    routeRevision,
  ]);

  const openDefault = useCallback(async (
    absolutePath: string | null = reference.absolutePath,
  ) => {
    if (!absolutePath) {
      return false;
    }
    const imperativePathKind = currentNativePathKind(absolutePath);
    if (!imperativePathKind) {
      return false;
    }
    return openInDefaultEditor(absolutePath, imperativePathKind);
  }, [currentNativePathKind, openInDefaultEditor, reference.absolutePath]);

  const reveal = useCallback(async (
    absolutePath: string | null = reference.absolutePath,
  ) => {
    if (!absolutePath || currentNativePathKind(absolutePath) !== "directory") {
      return;
    }
    if (!files) {
      return;
    }
    await files.reveal(absolutePath);
  }, [currentNativePathKind, files, reference.absolutePath]);

  const openPrimary = useCallback(async () => {
    let resolvedPathKind = pathKind;
    let resolvedWorkspacePath = reference.workspacePath;
    let resolvedAbsolutePath = reference.absolutePath;
    if (!resolvedAbsolutePath && needsHomeDirectory && files) {
      const resolvedHomeDirectory = await resolveHomeDirectory();
      if (currentRouteRevisionRef.current !== routeRevision) {
        return "unavailable";
      }
      if (resolvedHomeDirectory) {
        resolvedAbsolutePath = resolveFileReference({
          rawPath,
          workspaceRoot,
          resolveAbsolute,
          homeDirectory: resolvedHomeDirectory,
          workspacePathOverride: workspacePath,
        }).absolutePath;
      } else {
        setPathResolutionFailed(true);
        return "unavailable";
      }
    }
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
          setPathResolutionFailed(true);
          return "unavailable";
        }
      }
    }
    if (!resolvedWorkspacePath && resolvedAbsolutePath && files) {
      const inspection = await ensureDesktopPathInspection(resolvedAbsolutePath);
      if (currentRouteRevisionRef.current !== routeRevision) {
        return "unavailable";
      }
      resolvedPathKind = inspection?.kind === "file" || inspection?.kind === "directory"
        ? inspection.kind
        : null;
      if (!resolvedPathKind) {
        return "unavailable";
      }
    }

    if (currentRouteRevisionRef.current !== routeRevision) {
      return "unavailable";
    }

    const action = resolveFileReferencePrimaryAction({
      pathKind: resolvedPathKind,
      canOpenViewer: Boolean(resolvedWorkspacePath),
      canOpenExternal: Boolean(files && resolvedAbsolutePath),
      canReveal: Boolean(files && resolvedAbsolutePath),
    });
    if (action === "reveal") {
      try {
        if (
          !files
          || !resolvedAbsolutePath
          || resolvedPathKind !== "directory"
          || currentRouteRevisionRef.current !== routeRevision
        ) {
          return "unavailable";
        }
        await files.reveal(resolvedAbsolutePath);
      } catch {
        setPrimaryOpenFailed(true);
        return "unavailable";
      }
      setPathResolutionFailed(false);
      setPrimaryOpenFailed(false);
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
      setPathResolutionFailed(false);
      setPrimaryOpenFailed(false);
      return action;
    }
    if (action === "open-external") {
      if (
        !resolvedAbsolutePath
        || !resolvedPathKind
        || currentRouteRevisionRef.current !== routeRevision
      ) {
        return "unavailable";
      }
      const opened = await openInDefaultEditor(resolvedAbsolutePath, resolvedPathKind);
      if (!opened) {
        setPrimaryOpenFailed(true);
        return "unavailable";
      }
      setPathResolutionFailed(false);
      setPrimaryOpenFailed(false);
      return action;
    }
    return action;
  }, [
    files,
    activateViewerTarget,
    fuzzyResolveFilePath,
    ensureDesktopPathInspection,
    materializedWorkspaceId,
    needsHomeDirectory,
    openInDefaultEditor,
    openTarget,
    pathKind,
    rawPath,
    reference.absolutePath,
    reference.workspacePath,
    resolveAbsolute,
    resolveHomeDirectory,
    routeRevision,
    statWorkspacePath,
    statQuery,
    workspacePath,
    workspaceRoot,
    workspaceUiKey,
  ]);

  const openWithTarget = useCallback(async (targetId: string) => {
    if (
      !reference.absolutePath
      || currentNativePathKind(reference.absolutePath) === null
    ) {
      return;
    }
    if (!files) {
      return;
    }
    await files.openTarget(targetId, reference.absolutePath);
  }, [currentNativePathKind, files, reference.absolutePath]);

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
