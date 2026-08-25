import type {
  DesktopBridge,
  DesktopSupportSnapshotBridge,
  LocalRuntimeSnapshot,
  ProductCommand,
  RenderErrorReport,
  ScratchRecord,
  ScratchWriteResult,
  WorkerStatus,
  WorkerConfiguration,
} from "@proliferate/product-client/host/desktop-bridge";
import type {
  DesktopUpdate,
  DesktopUpdateDownloadProgress,
} from "@proliferate/product-client/host/desktop-updater-bridge";

import { getRuntimeInfo, restartRuntime } from "./runtime";
import {
  getHomeDir,
  inspectPath,
  listAvailableEditors,
  listOpenTargets,
  openInTerminal,
  openTarget,
  pickFolder,
  revealInFinder,
} from "./shell";
import { getDragPasteboardChangeCount, readDragDropPaths } from "./drag-drop";
import { showNativeContextMenu } from "./context-menu";
import { listenForShortcutMenuEvents } from "./menu";
import {
  applyMacWindowChrome,
  isMainTauriWebviewAvailable,
  revealCurrentWindow,
  setRunningAgentCount,
  setWebviewZoom,
} from "./window";
import { fetchServerMeta, isTauriRuntimeAvailable } from "./connect-server";
import { reportReactRenderError } from "@/lib/infra/diagnostics/renderer-error-diagnostics";
import { setWorkspaceActivityIndicator } from "./dock";
import {
  cancelOwnedDownload,
  checkForUpdate,
  checkForUpdateOwned,
  downloadAndInstall as downloadAndInstallUpdate,
  downloadOwnedStaged,
  getAppVersion,
  installOwnedStaged,
  isTauriPackaged,
  relaunch,
  stagedUpdateStatus,
} from "./updater";
import { getDesktopInstallId } from "./desktop-install-id";
import {
  ensureDesktopDispatchWorker,
  stopDesktopDispatchWorker,
} from "./cloud-worker";
import {
  readWorkspaceScratchPad,
  writeWorkspaceScratchPad,
} from "./workspace-scratch";
import { saveDiagnosticJson } from "./diagnostics";
import {
  beginSupportSnapshotPreparation,
  beginSupportSnapshotSubmission,
  cancelSupportSnapshotPreparation,
  deleteStagedSupportReportAttachment,
  deleteStagedSupportSnapshot,
  finishSupportSnapshotPreparation,
  finishSupportSnapshotSubmission,
  readStagedSupportReportAttachment,
  readStagedSupportSnapshot,
  reconcileStagedSupportSnapshots,
  saveSupportSnapshotArchive,
  stageSupportReportAttachment,
} from "./support";

const desktopSupportSnapshotBridge: DesktopSupportSnapshotBridge = {
  beginPreparation: beginSupportSnapshotPreparation,
  finishPreparation: finishSupportSnapshotPreparation,
  cancelPreparation: cancelSupportSnapshotPreparation,
  saveArchive: saveSupportSnapshotArchive,
  readArtifact: readStagedSupportSnapshot,
  deleteArtifact: deleteStagedSupportSnapshot,
  reconcileArtifacts: reconcileStagedSupportSnapshots,
  beginSubmission: beginSupportSnapshotSubmission,
  finishSubmission: finishSupportSnapshotSubmission,
};

/**
 * The concrete Desktop bridge. Every method is a thin shape adapter over an
 * existing `lib/access/tauri` function: it may rename arguments, normalize a
 * return or callback shape, and perform the explicit updater failure mapping.
 * It adds no retries, timeouts, caches, validation, logging, telemetry, or
 * fallbacks beyond what the underlying functions already provide.
 */
export const desktopBridge: DesktopBridge = {
  runtime: {
    async getConnection(): Promise<LocalRuntimeSnapshot> {
      const info = await getRuntimeInfo();
      return {
        connection: { runtimeUrl: info.url },
        status: info.status,
      };
    },
    async restart(): Promise<LocalRuntimeSnapshot> {
      const info = await restartRuntime();
      return {
        connection: { runtimeUrl: info.url },
        status: info.status,
      };
    },
  },

  files: {
    async pickDirectory() {
      if (!isTauriRuntimeAvailable()) {
        return { kind: "unavailable", reason: "native_host_required" };
      }
      try {
        const path = await pickFolder();
        return path ? { kind: "selected", path } : { kind: "cancelled" };
      } catch {
        return { kind: "unavailable", reason: "picker_failed" };
      }
    },
    getHomeDirectory: getHomeDir,
    inspectPath,
    getDragPasteboardChangeCount,
    readDroppedPaths: readDragDropPaths,
    listAvailableEditors,
    listOpenTargets,
    openTarget,
    reveal: revealInFinder,
    openTerminal: openInTerminal,
  },

  nativeUi: {
    showContextMenu: showNativeContextMenu,
    subscribeMenuCommands(
      listener: (command: ProductCommand) => void,
    ): () => void {
      // Native listener registration is async; expose a synchronous unsubscribe
      // that is race-safe if the caller unsubscribes before registration
      // resolves. Once unsubscribed no command is delivered and the eventual
      // unlisten is invoked as soon as it arrives.
      let unsubscribed = false;
      let unlisten: (() => void) | null = null;

      void listenForShortcutMenuEvents((command) => {
        if (unsubscribed) {
          return;
        }
        listener(command);
      }).then((fn) => {
        if (unsubscribed) {
          fn();
          return;
        }
        unlisten = fn;
      });

      return () => {
        unsubscribed = true;
        if (unlisten) {
          unlisten();
          unlisten = null;
        }
      };
    },
    setRunningAgentCount,
    setWorkspaceActivity: setWorkspaceActivityIndicator,
    setZoom: setWebviewZoom,
    applyMacosWindowChrome: applyMacWindowChrome,
    isMainWebviewAvailable: isMainTauriWebviewAvailable,
    revealCurrentWindow,
  },

  updater: {
    isSupported: isTauriPackaged,
    getVersion: getAppVersion,
    async check(): Promise<DesktopUpdate | null> {
      const result = await checkForUpdate();
      if (result.kind === "current") {
        return null;
      }
      if (result.kind === "error") {
        throw new Error(result.message);
      }
      return {
        version: result.version,
        title: result.title,
        handle: result.update,
      };
    },
    async downloadAndInstall(
      update: DesktopUpdate,
      onProgress?: (progress: DesktopUpdateDownloadProgress) => void,
    ): Promise<void> {
      let receivedBytes = 0;
      await downloadAndInstallUpdate(
        update.handle,
        onProgress
          ? (chunkLength, contentLength) => {
              receivedBytes += chunkLength;
              onProgress({
                receivedBytes,
                totalBytes: contentLength ?? null,
              });
            }
          : undefined,
      );
    },
    relaunch,
    async checkOwned(endpointOverride?: string): Promise<DesktopUpdate | null> {
      const result = await checkForUpdateOwned(endpointOverride);
      if (result.kind === "current") {
        return null;
      }
      if (result.kind === "error") {
        throw new Error(result.message);
      }
      return {
        version: result.version,
        title: result.title,
        handle: result.update,
      };
    },
    async downloadOwned(
      update: DesktopUpdate,
      onProgress?: (progress: DesktopUpdateDownloadProgress) => void,
    ): Promise<{ version: string; sha256: string }> {
      const staged = await downloadOwnedStaged(
        update.handle,
        onProgress
          ? (progress) =>
              onProgress({
                receivedBytes: progress.receivedBytes,
                totalBytes: progress.totalBytes,
              })
          : undefined,
      );
      return { version: staged.version, sha256: staged.sha256 };
    },
    async cancelDownload(): Promise<void> {
      await cancelOwnedDownload();
    },
    async stagedStatus(
      version: string,
    ): Promise<{ version: string; sha256: string } | null> {
      const staged = await stagedUpdateStatus(version);
      return staged ? { version: staged.version, sha256: staged.sha256 } : null;
    },
    async installStaged(update: DesktopUpdate): Promise<void> {
      await installOwnedStaged(update.handle, update.version);
    },
  },

  worker: {
    isSupported: isTauriRuntimeAvailable,
    getInstallId: getDesktopInstallId,
    ensure(input: WorkerConfiguration): Promise<WorkerStatus> {
      return ensureDesktopDispatchWorker(input);
    },
    async stop(): Promise<void> {
      await stopDesktopDispatchWorker();
    },
  },

  scratch: {
    read(workspaceId: string): Promise<ScratchRecord> {
      return readWorkspaceScratchPad(workspaceId);
    },
    write(workspaceId: string, content: string): Promise<ScratchWriteResult> {
      return writeWorkspaceScratchPad(workspaceId, content);
    },
  },

  diagnostics: {
    reportRenderError(report: RenderErrorReport): Promise<boolean> {
      // Dedup/fingerprint/suppression stays host-owned in reportReactRenderError.
      return reportReactRenderError(report.error, report.componentStack ?? null);
    },
    saveJson(input) {
      return saveDiagnosticJson(input.suggestedFileName, input.contents);
    },
    stageAttachment: stageSupportReportAttachment,
    readAttachment: readStagedSupportReportAttachment,
    deleteAttachment: deleteStagedSupportReportAttachment,
    get supportSnapshot() {
      return isTauriRuntimeAvailable() ? desktopSupportSnapshotBridge : null;
    },
  },

  connect: {
    fetchServerMeta,
  },
};
