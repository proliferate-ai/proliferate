import { useCallback, useMemo, useRef } from "react";
import type {
  DesktopFilesBridge,
  OpenTarget,
} from "@proliferate/product-client/host/desktop-bridge";
import type { FileReferencePathKind } from "#product/lib/domain/files/path-references";

export interface NativeFileReferenceCapability {
  source: "desktop" | "workspace-companion";
  absolutePath: string;
  kind: FileReferencePathKind;
  routeRevision: object;
}

interface UseDesktopFileReferenceActionsInput {
  files: DesktopFilesBridge | null;
  capability: NativeFileReferenceCapability | null;
  externalOpenCapability: NativeFileReferenceCapability | null;
  routeRevision: object;
  targets: readonly OpenTarget[];
  openInDefaultEditor: (
    absolutePath: string,
    imperativePathKind: FileReferencePathKind,
  ) => Promise<boolean>;
}

/** Invocation-time native capability checks shared by DOM and native menus. */
export function useDesktopFileReferenceActions({
  files,
  capability,
  externalOpenCapability,
  routeRevision,
  targets,
  openInDefaultEditor,
}: UseDesktopFileReferenceActionsInput) {
  const currentRef = useRef({ files, capability, externalOpenCapability, targets });
  currentRef.current = { files, capability, externalOpenCapability, targets };
  const openTargets = useMemo(
    () => externalOpenCapability
      ? targets.filter((target) => target.kind !== "copy")
      : [],
    [externalOpenCapability, targets],
  );

  const currentNativePathKind = useCallback((): FileReferencePathKind | null => {
    const current = currentRef.current;
    if (
      !current.files
      || !current.capability
      || current.capability.routeRevision !== routeRevision
      || current.capability.routeRevision !== capability?.routeRevision
    ) {
      return null;
    }
    return current.capability.kind;
  }, [capability?.routeRevision, routeRevision]);

  const currentExternalOpenCapability = useCallback(() => {
    const current = currentRef.current;
    if (
      !current.files
      || !current.externalOpenCapability
      || current.externalOpenCapability.routeRevision !== routeRevision
      || current.externalOpenCapability.routeRevision !== externalOpenCapability?.routeRevision
    ) {
      return null;
    }
    return current.externalOpenCapability;
  }, [externalOpenCapability?.routeRevision, routeRevision]);

  const openDefault = useCallback(async () => {
    const current = currentExternalOpenCapability();
    if (!current) return false;
    return openInDefaultEditor(current.absolutePath, current.kind);
  }, [currentExternalOpenCapability, openInDefaultEditor]);

  const reveal = useCallback(async () => {
    const current = currentRef.current;
    if (!current.files || !current.capability || !currentNativePathKind()) return;
    await current.files.reveal(current.capability.absolutePath);
  }, [currentNativePathKind]);

  const openWithTarget = useCallback(async (targetId: string) => {
    const current = currentRef.current;
    const openCapability = currentExternalOpenCapability();
    if (
      !current.files
      || !openCapability
      || !current.targets.some((target) => target.kind !== "copy" && target.id === targetId)
    ) {
      return;
    }
    await current.files.openTarget(targetId, openCapability.absolutePath);
  }, [currentExternalOpenCapability]);

  return { currentNativePathKind, openDefault, openTargets, openWithTarget, reveal };
}
