import { useCallback, useMemo, useRef, useState } from "react";
import { useStatWorkspaceFileQuery } from "@anyharness/sdk-react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useOpenInDefaultEditor } from "#product/hooks/editor/workflows/use-open-in-default-editor";
import { useWorkspaceFileLookup } from "#product/hooks/access/anyharness/files/use-workspace-file-lookup";
import {
  useDesktopFileReferenceActions,
} from "#product/hooks/workspaces/workflows/files/use-desktop-file-reference-actions";
import { useDesktopPathInspection } from "#product/hooks/workspaces/workflows/files/use-desktop-path-inspection";
import {
  fileReferenceAccessReason,
  fileReferenceUnavailableCopy,
  resolveFileReferenceAccessState,
  resolveNativeFileReferenceCapability,
  type AccessibleFileLocator,
  type FileReferenceRecoveryState,
} from "#product/hooks/workspaces/workflows/files/file-reference-access-state";
import { useFuzzyFileResolver } from "#product/hooks/workspaces/workflows/files/use-fuzzy-file-resolver";
import { useHomeRelativeFileReference } from "#product/hooks/workspaces/workflows/files/use-home-relative-file-reference";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import {
  fileReferenceCopyPath,
  isHomeRelativeFileReference,
  resolveFileReference,
  resolveWorkspaceStatPathKind,
  type FileReferencePrimaryAction,
} from "#product/lib/domain/files/path-references";
import { resolveSelectedWorkspaceIdentity } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import { fileViewerTarget } from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspacePath } from "#product/providers/WorkspacePathProvider";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";

interface UseFileReferenceActionsInput {
  rawPath: string;
  workspacePath?: string | null;
  /** Narrow native discovery for callers whose UI owns one exact path kind. */
  nativeCapabilityKind?: "file" | "directory";
}

export function useFileReferenceActions({
  rawPath,
  workspacePath,
  nativeCapabilityKind,
}: UseFileReferenceActionsInput) {
  const host = useProductHost();
  const files = host.desktop?.files ?? null;
  const openTarget = useWorkspaceViewerTabsStore((state) => state.openTarget);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { activateViewerTarget } = useWorkspaceShellActivation();
  const identity = useMemo(() => resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  }), [selectedLogicalWorkspaceId, selectedWorkspaceId]);
  const materializedWorkspaceId = identity.materializedWorkspaceId;
  const workspaceUiKey = identity.workspaceUiKey;
  const { filesystemOrigin, workspaceRoot } = useWorkspacePath();

  const unresolvedReference = useMemo(() => resolveFileReference({
    rawPath,
    workspacePathOverride: workspacePath,
    workspaceRoot,
    filesystemOrigin,
    desktopBridgeAvailable: files !== null,
  }), [files, filesystemOrigin, rawPath, workspacePath, workspaceRoot]);
  const homeCandidate = typeof workspacePath !== "string"
    && isHomeRelativeFileReference(rawPath)
    && unresolvedReference.locator.authority === "unavailable"
    && unresolvedReference.locator.reason === "home_unavailable"
    ? unresolvedReference.parsedPath
    : null;
  const home = useHomeRelativeFileReference({ files, candidatePath: homeCandidate });
  const reference = useMemo(() => resolveFileReference({
    rawPath,
    workspacePathOverride: workspacePath,
    workspaceRoot,
    filesystemOrigin,
    desktopBridgeAvailable: files !== null,
    homeDirectory: home.homeDirectory,
  }), [files, filesystemOrigin, home.homeDirectory, rawPath, workspacePath, workspaceRoot]);

  const routeRevision = useMemo(() => ({}), [
    files,
    filesystemOrigin.origin,
    filesystemOrigin.status,
    materializedWorkspaceId,
    nativeCapabilityKind,
    reference.locator,
    workspaceRoot.path,
    workspaceRoot.status,
  ]);
  const recoveryLocatorWorkspacePath = reference.locator.authority === "workspace"
    ? reference.locator.workspacePath
    : null;
  const recoveryLocatorCompanionPath = reference.locator.authority === "workspace"
    ? reference.locator.localCompanionPath
    : null;
  const recoveryLocatorAbsolutePath = reference.locator.authority === "desktop"
    ? reference.locator.absolutePath
    : null;
  const recoveryLocatorUnavailableReason = reference.locator.authority === "unavailable"
    ? reference.locator.reason
    : null;
  const recoveryRevision = useMemo(() => ({}), [
    filesystemOrigin.origin,
    filesystemOrigin.status,
    materializedWorkspaceId,
    recoveryLocatorAbsolutePath,
    recoveryLocatorCompanionPath,
    recoveryLocatorUnavailableReason,
    recoveryLocatorWorkspacePath,
    reference.locator.authority,
    workspaceRoot.path,
    workspaceRoot.status,
  ]);
  const currentRouteRevisionRef = useRef(routeRevision);
  currentRouteRevisionRef.current = routeRevision;
  const currentRecoveryRevisionRef = useRef(recoveryRevision);
  currentRecoveryRevisionRef.current = recoveryRevision;
  const workspaceLocator = reference.locator.authority === "workspace"
    ? reference.locator
    : null;
  const statQuery = useStatWorkspaceFileQuery({
    workspaceId: materializedWorkspaceId,
    path: workspaceLocator?.workspacePath ?? null,
    enabled: workspaceLocator !== null && materializedWorkspaceId !== null,
  });
  const desktopCandidatePath = reference.locator.authority === "desktop"
    ? reference.locator.absolutePath
    : null;
  const desktopInspection = useDesktopPathInspection({
    candidatePath: desktopCandidatePath,
    files,
    routeRevision,
  });
  const [recoveryState, setRecoveryState] = useState<FileReferenceRecoveryState>(null);
  const recoveryRef = useRef<FileReferenceRecoveryState>(recoveryState);
  recoveryRef.current = recoveryState;
  const setRecovery = useCallback((next: FileReferenceRecoveryState) => {
    recoveryRef.current = next;
    setRecoveryState(next);
  }, []);
  const activeRecovery = recoveryState?.recoveryRevision === recoveryRevision
    ? recoveryState
    : null;
  const accessState = resolveFileReferenceAccessState({
    locator: reference.locator,
    materializedWorkspaceId,
    statData: statQuery.data,
    statError: statQuery.error,
    statPending: statQuery.isPending || statQuery.isFetching,
    desktopInspectionState: desktopInspection.state,
    recovery: activeRecovery,
  });
  const pathKind = accessState.status === "settled" ? accessState.kind : null;
  const resolvedNativeCapability = resolveNativeFileReferenceCapability(accessState, routeRevision);
  const nativeCapability = resolvedNativeCapability
    && (!nativeCapabilityKind || resolvedNativeCapability.kind === nativeCapabilityKind)
    ? resolvedNativeCapability
    : null;
  const externalOpenCapability = nativeCapability
    && (
      nativeCapability.source === "desktop"
      || nativeCapability.kind === "file"
      || nativeCapabilityKind === "directory"
    )
    ? nativeCapability
    : null;
  const nativePathKind = nativeCapability?.kind ?? null;
  const { defaultTarget: defaultOpenTarget, openInDefaultEditor, targets } =
    useOpenInDefaultEditor(externalOpenCapability?.kind ?? null);
  const nativeActions = useDesktopFileReferenceActions({
    files,
    capability: nativeCapability,
    externalOpenCapability,
    routeRevision,
    targets,
    openInDefaultEditor,
  });
  const fuzzyResolve = useFuzzyFileResolver();
  const { statFile } = useWorkspaceFileLookup();
  const [failedPrimaryRoute, setFailedPrimaryRoute] = useState<object | null>(null);

  const latestRef = useRef({
    accessState,
    materializedWorkspaceId,
    recoveryRevision,
    reference,
    routeRevision,
    workspaceUiKey,
  });
  latestRef.current = {
    accessState,
    materializedWorkspaceId,
    recoveryRevision,
    reference,
    routeRevision,
    workspaceUiKey,
  };
  const copyPath = fileReferenceCopyPath(reference);
  const copyPathRef = useRef(copyPath);
  copyPathRef.current = copyPath;
  const clipboardRef = useRef(host.clipboard);
  clipboardRef.current = host.clipboard;
  const copyCurrentPath = useCallback(async () => {
    const current = copyPathRef.current;
    if (current === null) return;
    await clipboardRef.current.writeText(current);
  }, []);

  const openViewer = useCallback((path: string, snapshot: typeof latestRef.current) => {
    if (
      currentRouteRevisionRef.current !== snapshot.routeRevision
      || !snapshot.materializedWorkspaceId
    ) return false;
    const target = fileViewerTarget(path);
    openTarget(target);
    activateViewerTarget({
      workspaceId: snapshot.materializedWorkspaceId,
      shellWorkspaceId: snapshot.workspaceUiKey,
      target,
      mode: "open-or-focus",
    });
    return true;
  }, [activateViewerTarget, openTarget]);

  const openInSidebar = useCallback(async () => {
    const snapshot = latestRef.current;
    if (
      snapshot.routeRevision !== routeRevision
      || snapshot.accessState.status !== "settled"
      || snapshot.accessState.kind !== "file"
      || snapshot.accessState.locator.authority !== "workspace"
    ) return;
    openViewer(snapshot.accessState.locator.workspacePath, snapshot);
  }, [openViewer, routeRevision]);

  const recoverMissing = useCallback(async (
    locator: Extract<AccessibleFileLocator, { authority: "workspace" }>,
    snapshot: typeof latestRef.current,
  ): Promise<FileReferencePrimaryAction> => {
    if (!snapshot.materializedWorkspaceId || locator.workspacePath === "") return "unavailable";
    setRecovery({ recoveryRevision: snapshot.recoveryRevision, status: "recovering" });
    const outcome = await fuzzyResolve({
      workspacePath: locator.workspacePath,
      materializedWorkspaceId: snapshot.materializedWorkspaceId,
    });
    if (currentRecoveryRevisionRef.current !== snapshot.recoveryRevision) return "unavailable";
    if (outcome.status !== "match") {
      setRecovery({
        recoveryRevision: snapshot.recoveryRevision,
        status: "terminal",
        reason: outcome.status === "ambiguous"
          ? "ambiguous_match"
          : outcome.status === "search-error" ? "runtime_unavailable" : "not_found",
      });
      return "unavailable";
    }
    try {
      const correctedStat = await statFile({
        materializedWorkspaceId: snapshot.materializedWorkspaceId,
        path: outcome.workspacePath,
      });
      if (currentRecoveryRevisionRef.current !== snapshot.recoveryRevision) return "unavailable";
      const correctedKind = resolveWorkspaceStatPathKind(correctedStat);
      if (correctedKind !== "file") {
        setRecovery({
          recoveryRevision: snapshot.recoveryRevision,
          status: "terminal",
          reason: "unsupported_type",
        });
        return "unavailable";
      }
      const corrected = resolveFileReference({
        rawPath: snapshot.reference.rawPath,
        workspacePathOverride: outcome.workspacePath,
        workspaceRoot,
        filesystemOrigin,
        desktopBridgeAvailable: files !== null,
      }).locator;
      if (corrected.authority !== "workspace") {
        setRecovery({
          recoveryRevision: snapshot.recoveryRevision,
          status: "terminal",
          reason: "unexpected_kind",
        });
        return "unavailable";
      }
      setRecovery({
        recoveryRevision: snapshot.recoveryRevision,
        status: "settled",
        locator: corrected,
      });
      return openViewer(corrected.workspacePath, snapshot) ? "open-viewer" : "unavailable";
    } catch (error) {
      setRecovery({
        recoveryRevision: snapshot.recoveryRevision,
        status: "terminal",
        reason: fileReferenceAccessReason(error),
      });
      return "unavailable";
    }
  }, [files, filesystemOrigin, fuzzyResolve, openViewer, setRecovery, statFile, workspaceRoot]);

  const openPrimary = useCallback(async (): Promise<FileReferencePrimaryAction> => {
    const snapshot = latestRef.current;
    if (snapshot.routeRevision !== routeRevision) return "unavailable";
    const state = snapshot.accessState;
    if (state.status === "exact-missing") {
      if (recoveryRef.current?.recoveryRevision === snapshot.recoveryRevision) {
        return "unavailable";
      }
      return recoverMissing(state.locator, snapshot);
    }
    if (state.status !== "settled") return "unavailable";
    if (state.locator.authority === "workspace") {
      if (state.kind !== "file") return "unavailable";
      return openViewer(state.locator.workspacePath, snapshot) ? "open-viewer" : "unavailable";
    }
    if (state.kind === "directory") {
      await nativeActions.reveal();
      return "reveal";
    }
    const opened = await nativeActions.openDefault();
    setFailedPrimaryRoute(opened ? null : routeRevision);
    return opened ? "open-external" : "unavailable";
  }, [nativeActions, openViewer, recoverMissing, routeRevision]);

  const canOpenInSidebar = accessState.status === "settled"
    && accessState.kind === "file"
    && accessState.locator.authority === "workspace";
  const canOpenPrimary = canOpenInSidebar
    || (accessState.status === "settled" && accessState.locator.authority === "desktop")
    || accessState.status === "exact-missing";
  const pathKindPending = home.pending
    || accessState.status === "pending"
    || accessState.status === "recovering";

  return {
    reference,
    accessState,
    nativePathKind,
    openTargets: nativeActions.openTargets,
    defaultOpenTarget,
    pathKind,
    pathKindPending,
    canOpenInSidebar,
    canOpenExternal: externalOpenCapability !== null,
    canOpenPrimary,
    canReveal: nativeCapability !== null,
    primaryUnavailableReason: failedPrimaryRoute === routeRevision
      ? "Could not open this path. Click to retry."
      : fileReferenceUnavailableCopy(accessState),
    copyPath,
    copyCurrentPath,
    openInSidebar,
    openDefault: nativeActions.openDefault,
    openPrimary,
    openWithTarget: nativeActions.openWithTarget,
    reveal: nativeActions.reveal,
  };
}
