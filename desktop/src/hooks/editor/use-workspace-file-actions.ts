import { AnyHarnessError, type GitDiffOptions } from "@anyharness/sdk";
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
import {
  finishMeasurementOperation,
  getMeasurementRequestOptions,
  recordMeasurementMetric,
  startMeasurementOperation,
} from "@/lib/infra/debug-measurement";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { fileWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import { deriveWorkspaceFileTabSeed } from "@/lib/domain/workspaces/tabs/shell-file-seed";
import { resolveWithWorkspaceFallback } from "@/lib/domain/workspaces/workspace-keyed-preferences";
import { useWorkspaceFileTreeUiStore } from "@/stores/editor/workspace-file-tree-ui-store";
import {
  normalizeWorkspaceFileDiffDescriptor,
  useWorkspaceFilesStore,
  workspaceFileDiffPatchKey,
} from "@/stores/editor/workspace-files-store";
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

function isWorkspaceFilesContextCurrent(
  materializedWorkspaceId: string,
  initVersion: number,
): boolean {
  const state = useWorkspaceFilesStore.getState();
  return state.materializedWorkspaceId === materializedWorkspaceId
    && state.initVersion === initVersion;
}

function isMissingDirectoryError(error: unknown): error is AnyHarnessError {
  return error instanceof AnyHarnessError
    && (error.problem.code === "FILE_NOT_FOUND" || error.problem.code === "NOT_A_DIRECTORY");
}

function isInvalidFileError(error: unknown): error is AnyHarnessError {
  return error instanceof AnyHarnessError
    && (
      error.problem.code === "FILE_NOT_FOUND"
      || error.problem.code === "NOT_A_DIRECTORY"
      || error.problem.code === "NOT_A_FILE"
    );
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
  const setActiveShellTabKey = useWorkspaceUiStore(
    (state) => state.setActiveShellTabKeyForWorkspace,
  );
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
      workspaceUiKey,
      materializedWorkspaceId,
      anyharnessWorkspaceId,
      runtimeUrl,
      authToken,
      initVersion,
      buffersByPath,
    } = state;
    if (!materializedWorkspaceId || !anyharnessWorkspaceId || !runtimeUrl) {
      return;
    }
    if (!assertWorkspaceRuntimeReady(materializedWorkspaceId)) {
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
      const result = await client.files.read(anyharnessWorkspaceId, filePath);
      if (!isWorkspaceFilesContextCurrent(materializedWorkspaceId, initVersion)) {
        return;
      }
      setBufferLoaded(filePath, result);
    } catch (error) {
      if (!isWorkspaceFilesContextCurrent(materializedWorkspaceId, initVersion)) {
        return;
      }
      if (workspaceUiKey && isInvalidFileError(error)) {
        useWorkspaceFilesStore.getState().closeTab(filePath);
        return;
      }
      setBufferLoadError(filePath, String(error));
    }
  }, [setBufferLoadError, setBufferLoaded, setBufferLoading]);

  const loadDirectoryEntries = useCallback(async ({
    materializedWorkspaceId,
    anyharnessWorkspaceId,
    runtimeUrl,
    authToken,
    initVersion,
    dirPath,
    skipIfCached,
    treatMissingAsIdle,
  }: {
    materializedWorkspaceId: string;
    anyharnessWorkspaceId: string;
    runtimeUrl: string;
    authToken?: string | null;
    initVersion: number;
    dirPath: string;
    skipIfCached?: boolean;
    treatMissingAsIdle?: boolean;
  }): Promise<DirectoryLoadResult> => {
    const operationId = startMeasurementOperation({
      kind: "file_tree_expand",
      surfaces: ["file-tree", "workspace-shell"],
      maxDurationMs: 10_000,
    });
    if (skipIfCached && useWorkspaceFilesStore.getState().directoryEntriesByPath[dirPath]) {
      if (operationId) {
        recordMeasurementMetric({
          type: "cache",
          category: "file.list",
          operationId,
          decision: "hit",
          source: "workflow",
        });
        finishMeasurementOperation(operationId, "completed");
      }
      return "cached";
    }
    if (operationId) {
      recordMeasurementMetric({
        type: "cache",
        category: "file.list",
        operationId,
        decision: "miss",
        source: "workflow",
      });
    }

    setDirectoryLoadState(dirPath, "loading");

    try {
      const client = getAnyHarnessClient(buildConnection(runtimeUrl, authToken));
      const result = await client.files.list(
        anyharnessWorkspaceId,
        dirPath,
        getMeasurementRequestOptions({ operationId, category: "file.list" }),
      );
      if (!isWorkspaceFilesContextCurrent(materializedWorkspaceId, initVersion)) {
        return "stale";
      }
      const storeStartedAt = performance.now();
      setDirectoryEntries(dirPath, result.entries);
      if (operationId) {
        recordMeasurementMetric({
          type: "store",
          category: "file.list",
          operationId,
          durationMs: performance.now() - storeStartedAt,
          count: result.entries.length,
        });
        finishMeasurementOperation(operationId, "completed");
      }
      return "loaded";
    } catch (error) {
      if (!isWorkspaceFilesContextCurrent(materializedWorkspaceId, initVersion)) {
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
    materializedWorkspaceId,
    anyharnessWorkspaceId,
    runtimeUrl,
    authToken,
    initVersion,
    treeStateKey,
  }: {
    materializedWorkspaceId: string;
    anyharnessWorkspaceId: string;
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
      workspaceId: materializedWorkspaceId,
      treeStateKey,
      expandedCount: expandedDirectories.length,
    });

    for (const dirPath of expandedDirectories) {
      const result = await loadDirectoryEntries({
        materializedWorkspaceId,
        anyharnessWorkspaceId,
        runtimeUrl,
        authToken,
        initVersion,
        dirPath,
        treatMissingAsIdle: true,
      });

      if (!isWorkspaceFilesContextCurrent(materializedWorkspaceId, initVersion)) {
        return;
      }

      if (result === "missing") {
        removeExpandedDirectory(treeStateKey, dirPath);
        logLatency("workspace.files.rehydrate.pruned", {
          workspaceId: materializedWorkspaceId,
          treeStateKey,
          dirPath,
          elapsedMs: elapsedMs(rehydrateStartedAt),
        });
        continue;
      }

      if (result === "loaded" || result === "cached") {
        logLatency("workspace.files.rehydrate.success", {
          workspaceId: materializedWorkspaceId,
          treeStateKey,
          dirPath,
          elapsedMs: elapsedMs(rehydrateStartedAt),
        });
      }
    }
  }, [loadDirectoryEntries, removeExpandedDirectory]);

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
    const initVersion = prepareWorkspace({
      workspaceUiKey,
      materializedWorkspaceId,
      anyharnessWorkspaceId,
      runtimeUrl,
      treeStateKey,
      authToken,
      initialOpenTabs: fileTabSeed.initialOpenTabs,
      initialActiveFilePath: fileTabSeed.initialActiveFilePath,
    });

    try {
      if (!assertWorkspaceRuntimeReady(materializedWorkspaceId)) {
        setDirectoryLoadState("", "error");
        return;
      }
      const client = getAnyHarnessClient(buildConnection(runtimeUrl, authToken));
      const result = await client.files.list(anyharnessWorkspaceId, "");
      if (!isWorkspaceFilesContextCurrent(materializedWorkspaceId, initVersion)) {
        return;
      }
      setDirectoryEntries("", result.entries);
      await rehydrateExpandedDirectories({
        materializedWorkspaceId,
        anyharnessWorkspaceId,
        runtimeUrl,
        authToken,
        initVersion,
        treeStateKey,
      });
    } catch {
      if (!isWorkspaceFilesContextCurrent(materializedWorkspaceId, initVersion)) {
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
      materializedWorkspaceId,
      anyharnessWorkspaceId,
      runtimeUrl,
      authToken,
      treeStateKey,
      initVersion,
    } = state;
    if (!materializedWorkspaceId || !anyharnessWorkspaceId || !runtimeUrl || !treeStateKey) {
      return;
    }
    if (!assertWorkspaceRuntimeReady(materializedWorkspaceId)) {
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
      materializedWorkspaceId,
      anyharnessWorkspaceId,
      runtimeUrl,
      authToken,
      initVersion,
      dirPath,
      skipIfCached: true,
    });
  }, [assertWorkspaceRuntimeReady, collapseDirectory, expandDirectory, loadDirectoryEntries]);

  const openFile = useCallback(async (filePath: string) => {
    focusFileTab(filePath);
    const workspaceUiKey = useWorkspaceFilesStore.getState().workspaceUiKey;
    if (workspaceUiKey) {
      setActiveShellTabKey(workspaceUiKey, fileWorkspaceShellTabKey(filePath));
    }
    await readFileIntoStore(filePath);
  }, [focusFileTab, readFileIntoStore, setActiveShellTabKey]);

  const openFileDiff = useCallback(async (filePath: string, options?: GitDiffOptions) => {
    const state = useWorkspaceFilesStore.getState();
    const {
      workspaceUiKey,
      materializedWorkspaceId,
      anyharnessWorkspaceId,
      runtimeUrl,
      authToken,
      initVersion,
      tabPatches,
    } = state;
    if (!workspaceUiKey || !materializedWorkspaceId || !anyharnessWorkspaceId || !runtimeUrl) {
      return;
    }
    if (!assertWorkspaceRuntimeReady(materializedWorkspaceId)) {
      return;
    }

    const descriptor = normalizeWorkspaceFileDiffDescriptor(options);
    const patchKey = workspaceFileDiffPatchKey(filePath, descriptor);
    setDiffTab(filePath, tabPatches[patchKey] ?? null, descriptor);
    setActiveShellTabKey(workspaceUiKey, fileWorkspaceShellTabKey(filePath));

    const loadDiff = async () => {
      try {
        const client = getAnyHarnessClient(buildConnection(runtimeUrl, authToken));
        const diff = await client.git.getDiff(anyharnessWorkspaceId, filePath, descriptor);
        if (!isWorkspaceFilesContextCurrent(materializedWorkspaceId, initVersion)) {
          return;
        }
        setDiffTab(filePath, diff.patch ?? null, descriptor);
      } catch {
        if (!isWorkspaceFilesContextCurrent(materializedWorkspaceId, initVersion)) {
          return;
        }
        setDiffTab(filePath, null, descriptor);
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
      materializedWorkspaceId,
      anyharnessWorkspaceId,
      runtimeUrl,
      authToken,
      initVersion,
      buffersByPath,
    } = state;
    if (!materializedWorkspaceId || !anyharnessWorkspaceId || !runtimeUrl) {
      return;
    }
    if (!assertWorkspaceRuntimeReady(materializedWorkspaceId)) {
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
      const result = await client.files.write(anyharnessWorkspaceId, {
        path: filePath,
        content: buffer.localContent,
        expectedVersionToken: buffer.versionToken,
      });
      if (!isWorkspaceFilesContextCurrent(materializedWorkspaceId, initVersion)) {
        return;
      }
      applyFileSave(filePath, result.versionToken, buffer.localContent);
    } catch (error: unknown) {
      if (!isWorkspaceFilesContextCurrent(materializedWorkspaceId, initVersion)) {
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
