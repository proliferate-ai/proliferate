import { useCallback, useMemo, useRef } from "react";
import type {
  DesktopFilesBridge,
  OpenTarget,
} from "@proliferate/product-client/host/desktop-bridge";
import type {
  FileReferencePathKind,
  ResolvedFileReference,
} from "#product/lib/domain/files/path-references";
import type { DesktopPathInspectionState } from "#product/hooks/workspaces/workflows/files/use-desktop-path-inspection";

interface UseDesktopFileReferenceActionsInput {
  files: DesktopFilesBridge | null;
  reference: Pick<ResolvedFileReference, "absolutePath" | "workspacePath">;
  pathKind: FileReferencePathKind | null;
  desktopInspectionState: DesktopPathInspectionState;
  routeRevision: object;
  targets: readonly OpenTarget[];
  openInDefaultEditor: (
    absolutePath: string,
    imperativePathKind: FileReferencePathKind,
  ) => Promise<boolean>;
}

export function useDesktopFileReferenceActions({
  files,
  reference,
  pathKind,
  desktopInspectionState,
  routeRevision,
  targets,
  openInDefaultEditor,
}: UseDesktopFileReferenceActionsInput) {
  const currentRouteRevisionRef = useRef(routeRevision);
  currentRouteRevisionRef.current = routeRevision;
  const openTargets = useMemo(
    () => targets.filter((target) => target.kind !== "copy"),
    [targets],
  );

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
    if (!absolutePath || currentNativePathKind(absolutePath) !== "directory" || !files) {
      return;
    }
    await files.reveal(absolutePath);
  }, [currentNativePathKind, files, reference.absolutePath]);

  const openWithTarget = useCallback(async (targetId: string) => {
    if (
      !reference.absolutePath
      || currentNativePathKind(reference.absolutePath) === null
      || !files
    ) {
      return;
    }
    await files.openTarget(targetId, reference.absolutePath);
  }, [currentNativePathKind, files, reference.absolutePath]);

  return { openDefault, openTargets, openWithTarget, reveal };
}
