import { useCallback } from "react";
import {
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
} from "@anyharness/sdk-react";
import { useWorkspaceFilesCache } from "@/hooks/access/anyharness/files/use-workspace-files-cache";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import type { WorkspaceFileContext } from "@/hooks/workspaces/files/derived/use-workspace-file-context";
import { deriveWorkspaceFileTabSeed } from "@/lib/domain/workspaces/tabs/shell-file-seed";
import { resolveWithWorkspaceFallback } from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceFileTreeUiStore } from "@/stores/editor/workspace-file-tree-ui-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";

interface WorkspaceFileConnectionContext {
  materializedWorkspaceId: string;
  anyharnessWorkspaceId: string;
  runtimeUrl: string;
  treeStateKey: string;
  authToken?: string | null;
}

export interface WorkspaceFileAccessContext extends WorkspaceFileConnectionContext {
  workspaceUiKey: string;
}

type PrefetchWorkspaceDirectoriesInput = WorkspaceFileConnectionContext & {
  isCurrent?: () => boolean;
};

function directoryPathDepth(dirPath: string): number {
  return dirPath.split("/").filter(Boolean).length;
}

function getExpandedDirectoryPaths(treeStateKey: string): string[] {
  return Object.keys(
    useWorkspaceFileTreeUiStore.getState().expandedDirectoriesByTreeKey[treeStateKey] ?? {},
  ).sort((a, b) => directoryPathDepth(a) - directoryPathDepth(b) || a.localeCompare(b));
}

function workspaceFileBufferConnectionFingerprint(input: WorkspaceFileConnectionContext): string {
  return JSON.stringify([
    input.materializedWorkspaceId,
    input.anyharnessWorkspaceId,
    input.runtimeUrl,
  ]);
}

export function useWorkspaceFileInitializationActions(fileContext: WorkspaceFileContext) {
  const workspace = useAnyHarnessWorkspaceContext();
  const { prefetchWorkspaceDirectory } = useWorkspaceFilesCache();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const prepareWorkspace = useWorkspaceViewerTabsStore((state) => state.prepareWorkspace);
  const resetFileBuffersForConnection = useWorkspaceFileBuffersStore(
    (state) => state.resetForConnection,
  );
  const expandDirectory = useWorkspaceFileTreeUiStore((state) => state.expandDirectory);
  const collapseDirectory = useWorkspaceFileTreeUiStore((state) => state.collapseDirectory);
  const removeExpandedDirectory = useWorkspaceFileTreeUiStore(
    (state) => state.removeExpandedDirectory,
  );

  const assertWorkspaceRuntimeReady = useCallback((workspaceId: string): boolean => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return false;
    }
    return true;
  }, [getWorkspaceRuntimeBlockReason, showToast]);

  const resolveCurrentAccessContext = useCallback(async (): Promise<WorkspaceFileAccessContext | null> => {
    if (
      !fileContext.workspaceUiKey
      || !fileContext.materializedWorkspaceId
      || !fileContext.treeStateKey
    ) {
      return null;
    }
    const resolved = await resolveWorkspaceConnectionFromContext(
      workspace,
      fileContext.materializedWorkspaceId,
    );
    return {
      workspaceUiKey: fileContext.workspaceUiKey,
      materializedWorkspaceId: fileContext.materializedWorkspaceId,
      anyharnessWorkspaceId: resolved.connection.anyharnessWorkspaceId,
      runtimeUrl: resolved.connection.runtimeUrl,
      treeStateKey: fileContext.treeStateKey,
      authToken: resolved.connection.authToken ?? null,
    };
  }, [
    fileContext.materializedWorkspaceId,
    fileContext.treeStateKey,
    fileContext.workspaceUiKey,
    workspace,
  ]);

  const prepareFileWorkspace = useCallback((input: WorkspaceFileAccessContext) => {
    const workspaceUi = useWorkspaceUiStore.getState();
    const shellOrder = resolveWithWorkspaceFallback(
      workspaceUi.shellTabOrderByWorkspace,
      input.workspaceUiKey,
      input.materializedWorkspaceId,
    ).value;
    const activeShellTabKey = resolveWithWorkspaceFallback(
      workspaceUi.activeShellTabKeyByWorkspace,
      input.workspaceUiKey,
      input.materializedWorkspaceId,
    ).value ?? null;
    const rightPanelMaterialized = resolveWithWorkspaceFallback(
      workspaceUi.rightPanelMaterializedByWorkspace,
      input.materializedWorkspaceId,
      input.workspaceUiKey,
    ).value;
    const fileTabSeed = deriveWorkspaceFileTabSeed({
      shellOrderKeys: shellOrder,
      activeShellTabKey,
      rightPanelHeaderOrderKeys: rightPanelMaterialized?.headerOrder,
      rightPanelActiveEntryKey: rightPanelMaterialized?.activeEntryKey,
    });
    resetFileBuffersForConnection(workspaceFileBufferConnectionFingerprint(input));

    prepareWorkspace({
      workspaceUiKey: input.workspaceUiKey,
      materializedWorkspaceId: input.materializedWorkspaceId,
      initialOpenTargets: fileTabSeed.initialOpenTargets,
      initialActiveTargetKey: fileTabSeed.initialActiveTargetKey,
    });
  }, [prepareWorkspace, resetFileBuffersForConnection]);

  const prefetchWorkspaceDirectories = useCallback(async (
    input?: PrefetchWorkspaceDirectoriesInput,
  ) => {
    const accessContext = input ?? await resolveCurrentAccessContext();
    if (!accessContext) {
      return;
    }
    const isCurrent = input?.isCurrent;
    if (isCurrent && !isCurrent()) {
      return;
    }
    if (!assertWorkspaceRuntimeReady(accessContext.materializedWorkspaceId)) {
      return;
    }

    if (isCurrent && !isCurrent()) {
      return;
    }
    await prefetchWorkspaceDirectory({
      materializedWorkspaceId: accessContext.materializedWorkspaceId,
      anyharnessWorkspaceId: accessContext.anyharnessWorkspaceId,
      runtimeUrl: accessContext.runtimeUrl,
      authToken: accessContext.authToken,
      dirPath: "",
    });
    for (const dirPath of getExpandedDirectoryPaths(accessContext.treeStateKey)) {
      if (isCurrent && !isCurrent()) {
        return;
      }
      try {
        await prefetchWorkspaceDirectory({
          materializedWorkspaceId: accessContext.materializedWorkspaceId,
          anyharnessWorkspaceId: accessContext.anyharnessWorkspaceId,
          runtimeUrl: accessContext.runtimeUrl,
          authToken: accessContext.authToken,
          dirPath,
        });
      } catch {
        if (!isCurrent || isCurrent()) {
          removeExpandedDirectory(accessContext.treeStateKey, dirPath);
        }
      }
    }
  }, [
    assertWorkspaceRuntimeReady,
    prefetchWorkspaceDirectory,
    removeExpandedDirectory,
    resolveCurrentAccessContext,
  ]);

  const initForWorkspace = useCallback(async (input?: WorkspaceFileAccessContext) => {
    const accessContext = input ?? await resolveCurrentAccessContext();
    if (!accessContext) {
      return;
    }
    prepareFileWorkspace(accessContext);
    await prefetchWorkspaceDirectories(accessContext);
  }, [prefetchWorkspaceDirectories, prepareFileWorkspace, resolveCurrentAccessContext]);

  const toggleDirectory = useCallback(async (dirPath: string) => {
    if (
      !fileContext.materializedWorkspaceId
      || !fileContext.treeStateKey
    ) {
      return;
    }
    const isExpanded = Boolean(
      useWorkspaceFileTreeUiStore.getState()
        .expandedDirectoriesByTreeKey[fileContext.treeStateKey]?.[dirPath],
    );
    if (isExpanded) {
      collapseDirectory(fileContext.treeStateKey, dirPath);
      return;
    }
    expandDirectory(fileContext.treeStateKey, dirPath);
    if (!assertWorkspaceRuntimeReady(fileContext.materializedWorkspaceId)) {
      return;
    }
    const accessContext = await resolveCurrentAccessContext();
    if (!accessContext) {
      return;
    }
    await prefetchWorkspaceDirectory({
      materializedWorkspaceId: accessContext.materializedWorkspaceId,
      anyharnessWorkspaceId: accessContext.anyharnessWorkspaceId,
      runtimeUrl: accessContext.runtimeUrl,
      authToken: accessContext.authToken,
      dirPath,
    });
  }, [
    assertWorkspaceRuntimeReady,
    collapseDirectory,
    expandDirectory,
    fileContext.materializedWorkspaceId,
    fileContext.treeStateKey,
    prefetchWorkspaceDirectory,
    resolveCurrentAccessContext,
  ]);

  return {
    initForWorkspace,
    prepareFileWorkspace,
    prefetchWorkspaceDirectories,
    toggleDirectory,
  };
}
