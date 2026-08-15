import { useCallback, type MutableRefObject } from "react";
import type { DesktopUpdaterBridge } from "@proliferate/product-client/host/desktop-updater-bridge";
import { useUpdaterStore } from "#product/stores/updater/updater-store";
import {
  clearDevUpdaterMockDownload,
  startDevUpdaterMockDownload,
  updateDevUpdaterMock,
  writeDevUpdaterMock,
  type DevUpdaterMockState,
} from "./updater-dev-mock";
import { abortOwnedDownload, runDownloadAndPrepareRestart } from "./updater-download";
import {
  persistUpdaterMetadataSnapshot,
  runUpdateCheck,
  type UpdaterSchedulerDeps,
} from "./updater-check";
import { readUpdaterFlags } from "./updater-flags";

/**
 * Inputs the updater action creators close over. `depsRef` holds the module
 * scheduler's host facades in a ref so every callback keeps a stable dependency
 * array (host is a per-mount snapshot), matching the pre-split behavior.
 */
export interface UpdaterActionsParams {
  devMock: DevUpdaterMockState | null;
  isPackaged: boolean;
  updater: DesktopUpdaterBridge | null;
  depsRef: MutableRefObject<UpdaterSchedulerDeps>;
  availableVersion: string | null;
}

export interface UpdaterActions {
  checkNow: () => Promise<void>;
  clearManualCheckCompleted: () => void;
  downloadUpdate: () => Promise<void>;
  retryDownload: () => Promise<void>;
  cancelUpdate: () => Promise<void>;
  skipVersion: () => void;
  openRestartPrompt: () => void;
  closeRestartPrompt: () => void;
  scheduleRestartWhenIdle: () => void;
  cancelRestartCountdown: () => void;
  restartNow: () => Promise<void>;
}

/**
 * The updater's user-facing action creators. Extracted verbatim from
 * `useUpdater` so the hook file stays within the frontend line-count contract;
 * behavior and public API are unchanged.
 */
export function useUpdaterActions({
  devMock,
  isPackaged,
  updater,
  depsRef,
  availableVersion,
}: UpdaterActionsParams): UpdaterActions {
  const checkNow = useCallback(async () => {
    if (devMock) {
      const timestamp = new Date().toISOString();
      const completedAt = Date.now();
      updateDevUpdaterMock((current) =>
        current
          ? {
              ...current,
              lastCheckedAt: timestamp,
              // Mirror the real flow: a manual check that finds no update raises
              // the one-shot "up to date" signal.
              manualCheckCompletedAt:
                current.phase === "current" ? completedAt : current.manualCheckCompletedAt,
            }
          : current,
      );
      return;
    }

    if (!isPackaged || updater === null) {
      return;
    }
    await runUpdateCheck(updater, depsRef.current, { userInitiated: true });
  }, [devMock, isPackaged, updater, depsRef]);

  const clearManualCheckCompleted = useCallback(() => {
    if (devMock) {
      updateDevUpdaterMock((current) =>
        current ? { ...current, manualCheckCompletedAt: null } : current,
      );
      return;
    }
    useUpdaterStore.getState().clearManualCheckCompleted();
  }, [devMock]);

  const downloadUpdate = useCallback(async () => {
    if (devMock) {
      startDevUpdaterMockDownload();
      return;
    }

    if (!isPackaged || updater === null) {
      return;
    }
    const owned = (await readUpdaterFlags(depsRef.current.storage))
      .ownedUpdaterEnabled;
    await runDownloadAndPrepareRestart(updater, depsRef.current, {
      owned,
      storage: depsRef.current.storage,
    });
  }, [devMock, isPackaged, updater, depsRef]);

  const retryDownload = useCallback(async () => {
    if (devMock) {
      // "Retry now" is the stalled toast's commit button, so it has to do
      // something under the mock too — otherwise the one recovery path out of
      // the stall can't be exercised on the surface built to review it. Restart
      // the forced download and re-arm the stall clock, mirroring the real
      // store's `retryDownload`.
      updateDevUpdaterMock((current) =>
        current
          ? {
              ...current,
              phase: "downloading",
              downloadRetryCount: current.downloadRetryCount + 1,
              lastProgressAt: Date.now(),
              downloadStartedAt: Date.now(),
            }
          : current,
      );
      startDevUpdaterMockDownload();
      return;
    }

    if (!isPackaged || updater === null) {
      return;
    }
    // Abort-first: a retry must cancel any live (stalled) download and await the
    // ack before starting a new one, so there is never more than one live
    // download.
    await abortOwnedDownload(updater);
    const owned = (await readUpdaterFlags(depsRef.current.storage))
      .ownedUpdaterEnabled;
    useUpdaterStore.getState().retryDownload();
    await runDownloadAndPrepareRestart(updater, depsRef.current, {
      owned,
      storage: depsRef.current.storage,
    });
  }, [devMock, isPackaged, updater, depsRef]);

  /** Abandon this update entirely; the pill and any toast go away. */
  const cancelUpdate = useCallback(async () => {
    if (devMock) {
      writeDevUpdaterMock(null);
      return;
    }
    // Abort-first: tear down any live owned download before resetting, so a
    // reset can never strand a still-running transfer.
    if (updater !== null) {
      await abortOwnedDownload(updater);
    }
    useUpdaterStore.getState().reset();
  }, [devMock, updater]);

  const skipVersion = useCallback(() => {
    const version = availableVersion;
    if (devMock || version === null) {
      return;
    }
    useUpdaterStore.getState().skipVersion(version);
    // Persist so the skip survives relaunch (the store's skip list is seeded
    // from this on the next boot).
    void persistUpdaterMetadataSnapshot(depsRef.current.storage);
  }, [availableVersion, devMock, depsRef]);

  const cancelRestartCountdown = useCallback(() => {
    if (devMock) {
      // "Not now" has to actually stop the countdown under the mock too, or the
      // one cancellable state in the flow can't be exercised.
      updateDevUpdaterMock((current) =>
        current
          ? { ...current, restartCountdownStartedAt: null, restartWhenIdle: false }
          : current,
      );
      return;
    }
    useUpdaterStore.getState().cancelRestartCountdown();
  }, [devMock]);

  const openRestartPrompt = useCallback(() => {
    if (devMock) {
      updateDevUpdaterMock((current) =>
        current ? { ...current, restartPromptOpen: true } : current,
      );
      return;
    }
    useUpdaterStore.getState().setRestartPromptOpen(true);
  }, [devMock]);

  const closeRestartPrompt = useCallback(() => {
    if (devMock) {
      updateDevUpdaterMock((current) =>
        current ? { ...current, restartPromptOpen: false } : current,
      );
      return;
    }
    useUpdaterStore.getState().setRestartPromptOpen(false);
  }, [devMock]);

  const scheduleRestartWhenIdle = useCallback(() => {
    if (devMock) {
      updateDevUpdaterMock((current) =>
        current ? { ...current, restartWhenIdle: true, restartPromptOpen: false } : current,
      );
      return;
    }
    const store = useUpdaterStore.getState();
    store.setRestartWhenIdle(true);
    store.setRestartPromptOpen(false);
  }, [devMock]);

  const restartNow = useCallback(async () => {
    if (devMock) {
      clearDevUpdaterMockDownload();
      writeDevUpdaterMock(null);
      return;
    }

    if (!isPackaged || updater === null) {
      return;
    }
    useUpdaterStore.getState().setRestartPromptOpen(false);
    // Owned path: `ready` means staged + verified, not yet installed. Install
    // the staged bytes now (re-verified natively), then relaunch. The legacy
    // path already installed during download, so it only relaunches.
    const update = useUpdaterStore.getState()._update;
    const owned = (await readUpdaterFlags(depsRef.current.storage))
      .ownedUpdaterEnabled;
    if (owned && update !== null && typeof updater.installStaged === "function") {
      try {
        await updater.installStaged(update);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        useUpdaterStore.getState().setError(message, "download");
        return;
      }
    }
    await updater.relaunch();
  }, [devMock, isPackaged, updater, depsRef]);

  return {
    checkNow,
    clearManualCheckCompleted,
    downloadUpdate,
    retryDownload,
    cancelUpdate,
    skipVersion,
    openRestartPrompt,
    closeRestartPrompt,
    scheduleRestartWhenIdle,
    cancelRestartCountdown,
    restartNow,
  };
}
