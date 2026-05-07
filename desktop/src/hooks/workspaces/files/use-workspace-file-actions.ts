import { useCallback } from "react";
import { AnyHarnessError } from "@anyharness/sdk";
import {
  type AnyHarnessClientConnection,
  anyHarnessWorkspaceFileKey,
  anyHarnessWorkspaceFileTreeKey,
  useReadWorkspaceFileQuery,
  useWriteWorkspaceFileMutation,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { deriveWorkspaceFileTabSeed } from "@/lib/domain/workspaces/tabs/shell-file-seed";
import { resolveWithWorkspaceFallback } from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import {
  fileDiffViewerTarget,
  fileViewerTarget,
  type FileDiffViewerScope,
  type ViewerTarget,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import {
  listWorkspaceFiles,
  readWorkspaceFile,
} from "@/lib/access/anyharness/workspace-file-transport";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceFileTreeUiStore } from "@/stores/editor/workspace-file-tree-ui-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";

function buildConnection(
  runtimeUrl: string,
  authToken?: string | null,
): AnyHarnessClientConnection {
  return {
    runtimeUrl,
    authToken: authToken ?? undefined,
  };
}

function directoryPathDepth(dirPath: string): number {
  return dirPath.split("/").filter(Boolean).length;
}

function getExpandedDirectoryPaths(treeStateKey: string): string[] {
  return Object.keys(
    useWorkspaceFileTreeUiStore.getState().expandedDirectoriesByTreeKey[treeStateKey] ?? {},
  ).sort((a, b) => directoryPathDepth(a) - directoryPathDepth(b) || a.localeCompare(b));
}

export function useWorkspaceFileActions() {
  const queryClient = useQueryClient();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const prepareWorkspace = useWorkspaceViewerTabsStore((state) => state.prepareWorkspace);
  const openTarget = useWorkspaceViewerTabsStore((state) => state.openTarget);
  const materializedWorkspaceId = useWorkspaceViewerTabsStore((state) => state.materializedWorkspaceId);
  const resetFileBuffers = useWorkspaceFileBuffersStore((state) => state.reset);
  const setBufferSaveState = useWorkspaceFileBuffersStore((state) => state.setBufferSaveState);
  const applyFileSave = useWorkspaceFileBuffersStore((state) => state.applyFileSave);
  const replaceBufferFromRead = useWorkspaceFileBuffersStore((state) => state.replaceBufferFromRead);
  const expandDirectory = useWorkspaceFileTreeUiStore((state) => state.expandDirectory);
  const collapseDirectory = useWorkspaceFileTreeUiStore((state) => state.collapseDirectory);
  const removeExpandedDirectory = useWorkspaceFileTreeUiStore(
    (state) => state.removeExpandedDirectory,
  );
  const { activateViewerTarget } = useWorkspaceShellActivation();
  const writeMutation = useWriteWorkspaceFileMutation({
    workspaceId: materializedWorkspaceId,
  });

  const assertWorkspaceRuntimeReady = useCallback((workspaceId: string): boolean => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return false;
    }
    return true;
  }, [getWorkspaceRuntimeBlockReason, showToast]);

  const prefetchDirectory = useCallback(async ({
    materializedWorkspaceId,
    anyharnessWorkspaceId,
    runtimeUrl,
    authToken,
    dirPath,
  }: {
    materializedWorkspaceId: string;
    anyharnessWorkspaceId: string;
    runtimeUrl: string;
    authToken?: string | null;
    dirPath: string;
  }) => {
    await queryClient.prefetchQuery({
      queryKey: anyHarnessWorkspaceFileTreeKey(runtimeUrl, materializedWorkspaceId, dirPath),
      queryFn: async ({ signal }) => {
        return listWorkspaceFiles(
          buildConnection(runtimeUrl, authToken),
          anyharnessWorkspaceId,
          dirPath,
          { signal },
        );
      },
    });
  }, [queryClient]);

  const prepareFileWorkspace = useCallback(({
    workspaceUiKey,
    materializedWorkspaceId,
    anyharnessWorkspaceId,
    runtimeUrl,
    treeStateKey,
    authToken,
  }: {
    workspaceUiKey: string;
    materializedWorkspaceId: string;
    anyharnessWorkspaceId: string;
    runtimeUrl: string;
    treeStateKey: string;
    authToken?: string | null;
  }) => {
    const workspaceUi = useWorkspaceUiStore.getState();
    const shellOrder = resolveWithWorkspaceFallback(
      workspaceUi.shellTabOrderByWorkspace,
      workspaceUiKey,
      materializedWorkspaceId,
    ).value;
    const activeShellTabKey = resolveWithWorkspaceFallback(
      workspaceUi.activeShellTabKeyByWorkspace,
      workspaceUiKey,
      materializedWorkspaceId,
    ).value ?? null;
    const fileTabSeed = deriveWorkspaceFileTabSeed({
      shellOrderKeys: shellOrder,
      activeShellTabKey,
    });
    const currentViewerContext = useWorkspaceViewerTabsStore.getState();
    const isDifferentWorkspace = currentViewerContext.materializedWorkspaceId !== materializedWorkspaceId
      || currentViewerContext.anyharnessWorkspaceId !== anyharnessWorkspaceId
      || currentViewerContext.runtimeUrl !== runtimeUrl;
    if (isDifferentWorkspace) {
      resetFileBuffers();
    }

    prepareWorkspace({
      workspaceUiKey,
      materializedWorkspaceId,
      anyharnessWorkspaceId,
      runtimeUrl,
      treeStateKey,
      authToken,
      initialOpenTargets: fileTabSeed.initialOpenTargets,
      initialActiveTargetKey: fileTabSeed.initialActiveTargetKey,
    });
  }, [prepareWorkspace, resetFileBuffers]);

  const prefetchWorkspaceDirectories = useCallback(async ({
    materializedWorkspaceId,
    anyharnessWorkspaceId,
    runtimeUrl,
    treeStateKey,
    authToken,
    isCurrent,
  }: {
    materializedWorkspaceId: string;
    anyharnessWorkspaceId: string;
    runtimeUrl: string;
    treeStateKey: string;
    authToken?: string | null;
    isCurrent?: () => boolean;
  }) => {
    if (isCurrent && !isCurrent()) {
      return;
    }
    if (!assertWorkspaceRuntimeReady(materializedWorkspaceId)) {
      return;
    }

    if (isCurrent && !isCurrent()) {
      return;
    }
    await prefetchDirectory({
      materializedWorkspaceId,
      anyharnessWorkspaceId,
      runtimeUrl,
      authToken,
      dirPath: "",
    });
    for (const dirPath of getExpandedDirectoryPaths(treeStateKey)) {
      if (isCurrent && !isCurrent()) {
        return;
      }
      try {
        await prefetchDirectory({
          materializedWorkspaceId,
          anyharnessWorkspaceId,
          runtimeUrl,
          authToken,
          dirPath,
        });
      } catch {
        if (!isCurrent || isCurrent()) {
          removeExpandedDirectory(treeStateKey, dirPath);
        }
      }
    }
  }, [
    assertWorkspaceRuntimeReady,
    prefetchDirectory,
    removeExpandedDirectory,
  ]);

  const initForWorkspace = useCallback(async ({
    workspaceUiKey,
    materializedWorkspaceId,
    anyharnessWorkspaceId,
    runtimeUrl,
    treeStateKey,
    authToken,
  }: {
    workspaceUiKey: string;
    materializedWorkspaceId: string;
    anyharnessWorkspaceId: string;
    runtimeUrl: string;
    treeStateKey: string;
    authToken?: string | null;
  }) => {
    prepareFileWorkspace({
      workspaceUiKey,
      materializedWorkspaceId,
      anyharnessWorkspaceId,
      runtimeUrl,
      treeStateKey,
      authToken,
    });
    await prefetchWorkspaceDirectories({
      materializedWorkspaceId,
      anyharnessWorkspaceId,
      runtimeUrl,
      treeStateKey,
      authToken,
    });
  }, [prepareFileWorkspace, prefetchWorkspaceDirectories]);

  const toggleDirectory = useCallback(async (dirPath: string) => {
    const {
      materializedWorkspaceId,
      anyharnessWorkspaceId,
      runtimeUrl,
      authToken,
      treeStateKey,
    } = useWorkspaceViewerTabsStore.getState();
    if (!materializedWorkspaceId || !anyharnessWorkspaceId || !runtimeUrl || !treeStateKey) {
      return;
    }
    const isExpanded = Boolean(
      useWorkspaceFileTreeUiStore.getState().expandedDirectoriesByTreeKey[treeStateKey]?.[dirPath],
    );
    if (isExpanded) {
      collapseDirectory(treeStateKey, dirPath);
      return;
    }
    expandDirectory(treeStateKey, dirPath);
    if (assertWorkspaceRuntimeReady(materializedWorkspaceId)) {
      await prefetchDirectory({
        materializedWorkspaceId,
        anyharnessWorkspaceId,
        runtimeUrl,
        authToken,
        dirPath,
      });
    }
  }, [
    assertWorkspaceRuntimeReady,
    collapseDirectory,
    expandDirectory,
    prefetchDirectory,
  ]);

  const openViewerTarget = useCallback((target: ViewerTarget) => {
    openTarget(target);
    const { workspaceUiKey, materializedWorkspaceId } = useWorkspaceViewerTabsStore.getState();
    if (materializedWorkspaceId) {
      activateViewerTarget({
        workspaceId: materializedWorkspaceId,
        shellWorkspaceId: workspaceUiKey,
        target,
        mode: "open-or-focus",
      });
    }
  }, [activateViewerTarget, openTarget]);

  const openFile = useCallback(async (filePath: string) => {
    openViewerTarget(fileViewerTarget(filePath));
  }, [openViewerTarget]);

  const openFileDiff = useCallback(async (filePath: string, options?: {
    scope?: FileDiffViewerScope | null;
    baseRef?: string | null;
    oldPath?: string | null;
  }) => {
    const scope = options?.scope ?? "unstaged";
    openViewerTarget(fileDiffViewerTarget({
      path: filePath,
      scope,
      baseRef: options?.baseRef ?? null,
      oldPath: options?.oldPath ?? null,
    }));
  }, [openViewerTarget]);

  const saveFile = useCallback(async (filePath: string) => {
    const buffer = useWorkspaceFileBuffersStore.getState().buffersByPath[filePath];
    if (
      !buffer
      || !buffer.isDirty
      || buffer.localContent === null
      || !buffer.baseVersionToken
    ) {
      return;
    }
    setBufferSaveState(filePath, "saving");
    try {
      const result = await writeMutation.mutateAsync({
        path: filePath,
        content: buffer.localContent,
        expectedVersionToken: buffer.baseVersionToken,
      });
      applyFileSave(filePath, result.versionToken, buffer.localContent);
    } catch (error) {
      const isConflict =
        error instanceof AnyHarnessError
        && error.problem.code === "VERSION_MISMATCH";
      setBufferSaveState(filePath, isConflict ? "conflict" : "error", String(error));
    }
  }, [applyFileSave, setBufferSaveState, writeMutation]);

  const reloadFile = useCallback(async (filePath: string) => {
    const {
      anyharnessWorkspaceId,
      authToken,
      materializedWorkspaceId,
      runtimeUrl,
    } = useWorkspaceViewerTabsStore.getState();
    if (!anyharnessWorkspaceId || !materializedWorkspaceId || !runtimeUrl) {
      return;
    }

    const queryKey = anyHarnessWorkspaceFileKey(runtimeUrl, materializedWorkspaceId, filePath);
    await queryClient.invalidateQueries({ queryKey, exact: true });
    const read = await queryClient.fetchQuery({
      queryKey,
      queryFn: async ({ signal }) => {
        return readWorkspaceFile(
          buildConnection(runtimeUrl, authToken),
          anyharnessWorkspaceId,
          filePath,
          { signal },
        );
      },
      staleTime: 0,
    });
    replaceBufferFromRead(filePath, read);
  }, [queryClient, replaceBufferFromRead]);

  return {
    initForWorkspace,
    prepareFileWorkspace,
    prefetchWorkspaceDirectories,
    toggleDirectory,
    openFile,
    openFileDiff,
    openViewerTarget,
    saveFile,
    reloadFile,
  };
}

export { useReadWorkspaceFileQuery };
