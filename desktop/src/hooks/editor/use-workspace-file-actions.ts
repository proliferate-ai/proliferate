import { AnyHarnessError } from "@anyharness/sdk";
import {
  getAnyHarnessClient,
  type AnyHarnessClientConnection,
} from "@anyharness/sdk-react";
import { useCallback } from "react";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { fileWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceFileTreeUiStore } from "@/stores/editor/workspace-file-tree-ui-store";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceTabsStore } from "@/stores/workspaces/workspace-tabs-store";
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

function isWorkspaceFilesContextCurrent(
  workspaceId: string,
  initVersion: number,
): boolean {
  const state = useWorkspaceFilesStore.getState();
  return state.workspaceId === workspaceId && state.initVersion === initVersion;
}

function isMissingDirectoryError(error: unknown): error is AnyHarnessError {
  return error instanceof AnyHarnessError
    && (error.problem.code === "FILE_NOT_FOUND" || error.problem.code === "NOT_A_DIRECTORY");
}

function directoryPathDepth(dirPath: string): number {
  return dirPath.split("/").filter(Boolean).length;
}

function getExpandedDirectoryPaths(treeStateKey: string): string[] {
  return Object.keys(
    useWorkspaceFileTreeUiStore.getState().expandedDirectoriesByTreeKey[treeStateKey] ?? {},
  ).sort((a, b) => directoryPathDepth(a) - directoryPathDepth(b) || a.localeCompare(b));
}

type DirectoryLoadResult = "loaded" | "cached" | "missing" | "error" | "stale";

export function useWorkspaceFileActions() {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const prepareWorkspace = useWorkspaceFilesStore((state) => state.prepareWorkspace);
  const setDirectoryLoadState = useWorkspaceFilesStore((state) => state.setDirectoryLoadState);
  const setDirectoryEntries = useWorkspaceFilesStore((state) => state.setDirectoryEntries);
  const focusFileTab = useWorkspaceFilesStore((state) => state.focusFileTab);
  const setDiffTab = useWorkspaceFilesStore((state) => state.setDiffTab);
  const setActiveShellTabKey = useWorkspaceTabsStore((state) => state.setActiveShellTabKey);
  const setBufferLoading = useWorkspaceFilesStore((state) => state.setBufferLoading);
  const setBufferLoaded = useWorkspaceFilesStore((state) => state.setBufferLoaded);
  const setBufferLoadError = useWorkspaceFilesStore((state) => state.setBufferLoadError);
  const setBufferSaveState = useWorkspaceFilesStore((state) => state.setBufferSaveState);
  const applyFileSave = useWorkspaceFilesStore((state) => state.applyFileSave);
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

  const readFileIntoStore = useCallback(async (
    filePath: string,
    options?: { forceReload?: boolean },
  ) => {
    const state = useWorkspaceFilesStore.getState();
    const {
      workspaceId,
      runtimeWorkspaceId,
      runtimeUrl,
      authToken,
      initVersion,
      buffersByPath,
    } = state;
    if (!workspaceId || !runtimeWorkspaceId || !runtimeUrl) {
      return;
    }
    if (!assertWorkspaceRuntimeReady(workspaceId)) {
      return;
    }

    const existing = buffersByPath[filePath];
    if (
      !options?.forceReload
      && existing
      && (existing.loadState === "loaded" || existing.loadState === "loading")
    ) {
      return;
    }

    setBufferLoading(filePath);

    try {
      const client = getAnyHarnessClient(buildConnection(runtimeUrl, authToken));
      const result = await client.files.read(runtimeWorkspaceId, filePath);
      if (!isWorkspaceFilesContextCurrent(workspaceId, initVersion)) {
        return;
      }
      setBufferLoaded(filePath, result);
    } catch (error) {
      if (!isWorkspaceFilesContextCurrent(workspaceId, initVersion)) {
        return;
      }
      setBufferLoadError(filePath, String(error));
    }
  }, [setBufferLoadError, setBufferLoaded, setBufferLoading]);

  const loadDirectoryEntries = useCallback(async ({
    workspaceId,
    runtimeWorkspaceId,
    runtimeUrl,
    authToken,
    initVersion,
    dirPath,
    skipIfCached,
    treatMissingAsIdle,
  }: {
    workspaceId: string;
    runtimeWorkspaceId: string;
    runtimeUrl: string;
    authToken?: string | null;
    initVersion: number;
    dirPath: string;
    skipIfCached?: boolean;
    treatMissingAsIdle?: boolean;
  }): Promise<DirectoryLoadResult> => {
    if (skipIfCached && useWorkspaceFilesStore.getState().directoryEntriesByPath[dirPath]) {
      return "cached";
    }

    setDirectoryLoadState(dirPath, "loading");

    try {
      const client = getAnyHarnessClient(buildConnection(runtimeUrl, authToken));
      const result = await client.files.list(runtimeWorkspaceId, dirPath);
      if (!isWorkspaceFilesContextCurrent(workspaceId, initVersion)) {
        return "stale";
      }
      setDirectoryEntries(dirPath, result.entries);
      return "loaded";
    } catch (error) {
      if (!isWorkspaceFilesContextCurrent(workspaceId, initVersion)) {
        return "stale";
      }
      if (treatMissingAsIdle && isMissingDirectoryError(error)) {
        setDirectoryLoadState(dirPath, "idle");
        return "missing";
      }
      setDirectoryLoadState(dirPath, "error");
      return isMissingDirectoryError(error) ? "missing" : "error";
    }
  }, [setDirectoryEntries, setDirectoryLoadState]);

  const rehydrateExpandedDirectories = useCallback(async ({
    workspaceId,
    runtimeWorkspaceId,
    runtimeUrl,
    authToken,
    initVersion,
    treeStateKey,
  }: {
    workspaceId: string;
    runtimeWorkspaceId: string;
    runtimeUrl: string;
    authToken?: string | null;
    initVersion: number;
    treeStateKey: string;
  }) => {
    const expandedDirectories = getExpandedDirectoryPaths(treeStateKey);
    if (expandedDirectories.length === 0) {
      return;
    }

    const rehydrateStartedAt = startLatencyTimer();
    logLatency("workspace.files.rehydrate.start", {
      workspaceId,
      treeStateKey,
      expandedCount: expandedDirectories.length,
    });

    for (const dirPath of expandedDirectories) {
      const result = await loadDirectoryEntries({
        workspaceId,
        runtimeWorkspaceId,
        runtimeUrl,
        authToken,
        initVersion,
        dirPath,
        treatMissingAsIdle: true,
      });

      if (!isWorkspaceFilesContextCurrent(workspaceId, initVersion)) {
        return;
      }

      if (result === "missing") {
        removeExpandedDirectory(treeStateKey, dirPath);
        logLatency("workspace.files.rehydrate.pruned", {
          workspaceId,
          treeStateKey,
          dirPath,
          elapsedMs: elapsedMs(rehydrateStartedAt),
        });
        continue;
      }

      if (result === "loaded" || result === "cached") {
        logLatency("workspace.files.rehydrate.success", {
          workspaceId,
          treeStateKey,
          dirPath,
          elapsedMs: elapsedMs(rehydrateStartedAt),
        });
      }
    }
  }, [loadDirectoryEntries, removeExpandedDirectory]);

  const initForWorkspace = useCallback(async (
    workspaceId: string,
    runtimeUrl: string,
    treeStateKey: string,
    runtimeWorkspaceId?: string,
    authToken?: string,
  ) => {
    const resolvedRuntimeWorkspaceId = runtimeWorkspaceId ?? workspaceId;
    const initVersion = prepareWorkspace(
      workspaceId,
      runtimeUrl,
      treeStateKey,
      resolvedRuntimeWorkspaceId,
      authToken,
    );

    try {
      if (!assertWorkspaceRuntimeReady(workspaceId)) {
        setDirectoryLoadState("", "error");
        return;
      }
      const client = getAnyHarnessClient(buildConnection(runtimeUrl, authToken));
      const result = await client.files.list(resolvedRuntimeWorkspaceId, "");
      if (!isWorkspaceFilesContextCurrent(workspaceId, initVersion)) {
        return;
      }
      setDirectoryEntries("", result.entries);
      await rehydrateExpandedDirectories({
        workspaceId,
        runtimeWorkspaceId: resolvedRuntimeWorkspaceId,
        runtimeUrl,
        authToken,
        initVersion,
        treeStateKey,
      });
    } catch {
      if (!isWorkspaceFilesContextCurrent(workspaceId, initVersion)) {
        return;
      }
      setDirectoryLoadState("", "error");
    }
  }, [
    assertWorkspaceRuntimeReady,
    prepareWorkspace,
    rehydrateExpandedDirectories,
    setDirectoryEntries,
    setDirectoryLoadState,
  ]);

  const toggleDirectory = useCallback(async (dirPath: string) => {
    const state = useWorkspaceFilesStore.getState();
    const {
      workspaceId,
      runtimeWorkspaceId,
      runtimeUrl,
      authToken,
      treeStateKey,
      initVersion,
    } = state;
    if (!workspaceId || !runtimeWorkspaceId || !runtimeUrl || !treeStateKey) {
      return;
    }
    if (!assertWorkspaceRuntimeReady(workspaceId)) {
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
    await loadDirectoryEntries({
      workspaceId,
      runtimeWorkspaceId,
      runtimeUrl,
      authToken,
      initVersion,
      dirPath,
      skipIfCached: true,
    });
  }, [assertWorkspaceRuntimeReady, collapseDirectory, expandDirectory, loadDirectoryEntries]);

  const openFile = useCallback(async (filePath: string) => {
    focusFileTab(filePath);
    const workspaceId = useWorkspaceFilesStore.getState().workspaceId;
    if (workspaceId) {
      setActiveShellTabKey(workspaceId, fileWorkspaceShellTabKey(filePath));
    }
    await readFileIntoStore(filePath);
  }, [focusFileTab, readFileIntoStore, setActiveShellTabKey]);

  const openFileDiff = useCallback(async (filePath: string) => {
    const state = useWorkspaceFilesStore.getState();
    const {
      workspaceId,
      runtimeWorkspaceId,
      runtimeUrl,
      authToken,
      initVersion,
      tabPatches,
    } = state;
    if (!workspaceId || !runtimeWorkspaceId || !runtimeUrl) {
      return;
    }
    if (!assertWorkspaceRuntimeReady(workspaceId)) {
      return;
    }

    setDiffTab(filePath, tabPatches[filePath] ?? null);
    setActiveShellTabKey(workspaceId, fileWorkspaceShellTabKey(filePath));

    const loadDiff = async () => {
      try {
        const client = getAnyHarnessClient(buildConnection(runtimeUrl, authToken));
        const diff = await client.git.getDiff(runtimeWorkspaceId, filePath);
        if (!isWorkspaceFilesContextCurrent(workspaceId, initVersion)) {
          return;
        }
        setDiffTab(filePath, diff.patch ?? null);
      } catch {
        if (!isWorkspaceFilesContextCurrent(workspaceId, initVersion)) {
          return;
        }
        setDiffTab(filePath, null);
      }
    };

    await Promise.all([
      loadDiff(),
      readFileIntoStore(filePath),
    ]);
  }, [assertWorkspaceRuntimeReady, readFileIntoStore, setActiveShellTabKey, setDiffTab]);

  const saveFile = useCallback(async (filePath: string) => {
    const state = useWorkspaceFilesStore.getState();
    const {
      workspaceId,
      runtimeWorkspaceId,
      runtimeUrl,
      authToken,
      initVersion,
      buffersByPath,
    } = state;
    if (!workspaceId || !runtimeWorkspaceId || !runtimeUrl) {
      return;
    }
    if (!assertWorkspaceRuntimeReady(workspaceId)) {
      return;
    }

    const buffer = buffersByPath[filePath];
    if (
      !buffer
      || !buffer.isDirty
      || buffer.localContent === null
      || !buffer.versionToken
    ) {
      return;
    }

    setBufferSaveState(filePath, "saving");

    try {
      const client = getAnyHarnessClient(buildConnection(runtimeUrl, authToken));
      const result = await client.files.write(runtimeWorkspaceId, {
        path: filePath,
        content: buffer.localContent,
        expectedVersionToken: buffer.versionToken,
      });
      if (!isWorkspaceFilesContextCurrent(workspaceId, initVersion)) {
        return;
      }
      applyFileSave(filePath, result.versionToken, buffer.localContent);
    } catch (error: unknown) {
      if (!isWorkspaceFilesContextCurrent(workspaceId, initVersion)) {
        return;
      }
      const isConflict =
        error
        && typeof error === "object"
        && "problem" in error
        && (error as { problem?: { code?: string } }).problem?.code === "VERSION_MISMATCH";
      setBufferSaveState(
        filePath,
        isConflict ? "conflict" : "error",
        String(error),
      );
    }
  }, [applyFileSave, assertWorkspaceRuntimeReady, setBufferSaveState]);

  const reloadFile = useCallback(async (filePath: string) => {
    await readFileIntoStore(filePath, { forceReload: true });
  }, [readFileIntoStore]);

  return {
    initForWorkspace,
    toggleDirectory,
    openFile,
    openFileDiff,
    saveFile,
    reloadFile,
  };
}
