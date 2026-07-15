import type {
  DesktopBridge,
  DesktopUpdate,
  LocalRuntimeConnection,
  LocalRuntimeSnapshot,
  ProductCommand,
  ScratchRecord,
  ScratchWriteResult,
  SshProfile,
  WorkerStatus,
  WorkerConfiguration,
} from "@proliferate/product-client/host/desktop-bridge";

import { getRuntimeInfo } from "./runtime";
import {
  deleteEnvVarSecret,
  listConfiguredEnvVarNames,
  restartRuntime,
  setEnvVarSecret,
} from "./credentials";
import {
  getHomeDir,
  listAvailableEditors,
  listOpenTargets,
  openInTerminal,
  openTarget,
  pathIsDirectory,
  pickFolder,
  revealInFinder,
} from "./shell";
import { showNativeContextMenu } from "./context-menu";
import { listenForShortcutMenuEvents } from "./menu";
import { setRunningAgentCount, setWebviewZoom } from "./window";
import { setWorkspaceActivityIndicator } from "./dock";
import {
  checkForUpdate,
  downloadAndInstall as downloadAndInstallUpdate,
  getAppVersion,
  isTauriPackaged,
  relaunch,
} from "./updater";
import { getDesktopInstallId } from "./desktop-install-id";
import {
  ensureDesktopDispatchWorker,
  stopDesktopDispatchWorker,
} from "./cloud-worker";
import {
  deleteSshDirectTargetProfile,
  getSshDirectTargetProfile,
  setSshDirectTargetProfile,
} from "./ssh-target-profile";
import { ensureSshAnyHarnessTunnel } from "./ssh-tunnel";
import {
  readWorkspaceScratchPad,
  writeWorkspaceScratchPad,
} from "./workspace-scratch";
import {
  collectSupportDiagnostics,
  logRendererEvent,
  saveDiagnosticJson,
} from "./diagnostics";
import {
  deleteStagedSupportReportAttachment,
  readStagedSupportReportAttachment,
  stageSupportReportAttachment,
} from "./support";

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
    pickDirectory: pickFolder,
    getHomeDirectory: getHomeDir,
    isDirectory: pathIsDirectory,
    listAvailableEditors,
    listOpenTargets,
    openTarget,
    reveal: revealInFinder,
    openTerminal: openInTerminal,
  },

  localCredentials: {
    listConfigured: listConfiguredEnvVarNames,
    set(name: string, secret: string): Promise<void> {
      return setEnvVarSecret(name, secret);
    },
    remove(name: string): Promise<void> {
      return deleteEnvVarSecret(name);
    },
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
      onProgress?: (fraction: number) => void,
    ): Promise<void> {
      let received = 0;
      await downloadAndInstallUpdate(
        update.handle,
        onProgress
          ? (chunkLength, contentLength) => {
              received += chunkLength;
              // A bounded 0..1 fraction is only meaningful once the total
              // length is known.
              if (contentLength !== undefined && contentLength > 0) {
                onProgress(Math.min(received / contentLength, 1));
              }
            }
          : undefined,
      );
    },
    relaunch,
  },

  worker: {
    getInstallId: getDesktopInstallId,
    ensure(input: WorkerConfiguration): Promise<WorkerStatus> {
      return ensureDesktopDispatchWorker(input);
    },
    async stop(): Promise<void> {
      await stopDesktopDispatchWorker();
    },
  },

  ssh: {
    getProfile: getSshDirectTargetProfile,
    saveProfile: setSshDirectTargetProfile,
    removeProfile: deleteSshDirectTargetProfile,
    async ensureTunnel(profile: SshProfile): Promise<LocalRuntimeConnection> {
      const tunnel = await ensureSshAnyHarnessTunnel({
        targetId: profile.targetId,
        sshHost: profile.sshHost,
        sshUser: profile.sshUser,
        sshPort: profile.sshPort,
        identityFile: profile.identityFile,
        remoteAnyHarnessPort: profile.remoteAnyHarnessPort,
      });
      return { runtimeUrl: tunnel.localUrl };
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
    logEvent: logRendererEvent,
    collectSupportBundle: collectSupportDiagnostics,
    saveJson(input) {
      return saveDiagnosticJson(input.suggestedFileName, input.contents);
    },
    stageAttachment: stageSupportReportAttachment,
    readAttachment: readStagedSupportReportAttachment,
    deleteAttachment: deleteStagedSupportReportAttachment,
  },
};
