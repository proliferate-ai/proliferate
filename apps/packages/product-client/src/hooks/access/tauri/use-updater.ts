import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useUpdaterStore } from "#product/stores/updater/updater-store";
import type { UpdaterErrorSource, UpdaterPhase } from "#product/stores/updater/updater-store";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { useProductStorageContext } from "#product/hooks/persistence/facade/use-product-storage-context";
import {
  clearDevUpdaterMockDownload,
  DEV_UPDATER_MOCK_EVENT,
  isDevUpdaterMockSupported,
  readDevUpdaterMock,
  seedDevUpdaterMockFromEnv,
  startDevUpdaterMockDownload,
  updateDevUpdaterMock,
  writeDevUpdaterMock,
  type DevUpdaterMockState,
} from "./updater-dev-mock";
import { runDownloadAndPrepareRestart } from "./updater-download";
import {
  attachAutoCheckScheduler,
  runUpdateCheck,
  type UpdaterSchedulerDeps,
} from "./updater-check";
import { isDownloadStalled } from "#product/lib/domain/updates/download-stall";

/** How often the stall clock is read. Well under the 8s threshold it tests. */
const STALL_POLL_INTERVAL_MS = 1_000;

export function useUpdater() {
  const updater = useProductHost().desktop?.updater ?? null;
  const telemetry = useProductTelemetry();
  const storageContext = useProductStorageContext();
  // Arm the module-level scheduler's host facades (ruling G1). Held in a ref so
  // the auto-check effect and the action callbacks keep their existing
  // dependency arrays (host is a stable per-mount snapshot, so deps never
  // change identity mid-mount anyway).
  const deps = useMemo<UpdaterSchedulerDeps>(
    () => ({
      track: (name, payload) => telemetry.track(name, payload),
      captureException: (error, context) =>
        telemetry.captureException(error, context),
      storage: storageContext,
    }),
    [telemetry, storageContext],
  );
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const storePhase = useUpdaterStore((s) => s.phase);
  const storeAvailableVersion = useUpdaterStore((s) => s.availableVersion);
  const storeAvailableTitle = useUpdaterStore((s) => s.availableTitle);
  const storeLastCheckedAt = useUpdaterStore((s) => s.lastCheckedAt);
  const storeErrorMessage = useUpdaterStore((s) => s.errorMessage);
  const storeErrorSource = useUpdaterStore((s) => s.errorSource);
  const storeDownloadProgress = useUpdaterStore((s) => s.downloadProgress);
  const storeDownloadReceivedBytes = useUpdaterStore((s) => s.downloadReceivedBytes);
  const storeDownloadTotalBytes = useUpdaterStore((s) => s.downloadTotalBytes);
  const storeRestartPromptOpen = useUpdaterStore((s) => s.restartPromptOpen);
  const storeRestartWhenIdle = useUpdaterStore((s) => s.restartWhenIdle);
  const storeManualCheckCompletedAt = useUpdaterStore((s) => s.manualCheckCompletedAt);
  const storeLastProgressAt = useUpdaterStore((s) => s.lastProgressAt);
  const storeDownloadStartedAt = useUpdaterStore((s) => s.downloadStartedAt);
  const storeDownloadRetryCount = useUpdaterStore((s) => s.downloadRetryCount);
  const storeCheckOrigin = useUpdaterStore((s) => s.checkOrigin);
  const storeRestartCountdownStartedAt = useUpdaterStore(
    (s) => s.restartCountdownStartedAt,
  );
  const isPackaged = updater?.isSupported() ?? false;
  const [devMock, setDevMock] = useState<DevUpdaterMockState | null>(() => readDevUpdaterMock());

  const phase = devMock?.phase ?? storePhase;
  const availableVersion = devMock?.version ?? storeAvailableVersion;
  const availableTitle = devMock
    ? devMock.title ?? null
    : storeAvailableTitle;
  const lastCheckedAt = devMock?.lastCheckedAt ?? storeLastCheckedAt;
  const errorMessage = devMock?.errorMessage ?? storeErrorMessage;
  const errorSource = devMock ? devMock.errorSource : storeErrorSource;
  const downloadProgress = devMock
    ? devMock.downloadProgress
    : storeDownloadProgress;
  const downloadReceivedBytes = devMock
    ? devMock.downloadReceivedBytes
    : storeDownloadReceivedBytes;
  const downloadTotalBytes = devMock
    ? devMock.downloadTotalBytes
    : storeDownloadTotalBytes;
  const restartPromptOpen = devMock?.restartPromptOpen ?? storeRestartPromptOpen;
  const restartWhenIdle = devMock ? devMock.restartWhenIdle : storeRestartWhenIdle;
  const manualCheckCompletedAt = devMock
    ? devMock.manualCheckCompletedAt
    : storeManualCheckCompletedAt;
  const updatesSupported = isPackaged || devMock !== null;
  // The dev mock forces a phase directly, so its stall/retry/countdown figures
  // are supplied by the mock rather than measured from a live download. They
  // still have to reach the surfaces: the stall copy and the restart countdown
  // are authored *from* these numbers, so nulling them would make two states
  // unreachable in dev and therefore unreviewable.
  const lastProgressAt = devMock ? devMock.lastProgressAt : storeLastProgressAt;
  const downloadStartedAt = devMock ? null : storeDownloadStartedAt;
  const downloadRetryCount = devMock
    ? devMock.downloadRetryCount
    : storeDownloadRetryCount;
  const checkOrigin = devMock ? "manual" : storeCheckOrigin;
  const restartCountdownStartedAt = devMock
    ? devMock.restartCountdownStartedAt
    : storeRestartCountdownStartedAt;

  useEffect(() => {
    if (!isDevUpdaterMockSupported()) {
      return;
    }

    seedDevUpdaterMockFromEnv();

    const syncDevMock = () => {
      setDevMock(readDevUpdaterMock());
    };

    window.addEventListener("storage", syncDevMock);
    window.addEventListener(DEV_UPDATER_MOCK_EVENT, syncDevMock);
    syncDevMock();

    return () => {
      window.removeEventListener("storage", syncDevMock);
      window.removeEventListener(DEV_UPDATER_MOCK_EVENT, syncDevMock);
    };
  }, []);

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
  }, [devMock, isPackaged, updater]);

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
    await runDownloadAndPrepareRestart(updater, depsRef.current);
  }, [devMock, isPackaged, updater]);

  /**
   * Stall detection: while a download is in flight, poll the byte clock and
   * name the silence. The clock lives in the store (set by every progress
   * event), so this only decides when the silence has lasted long enough.
   */
  useEffect(() => {
    if (phase !== "downloading" || devMock) {
      return;
    }
    const interval = window.setInterval(() => {
      const state = useUpdaterStore.getState();
      if (state.phase !== "downloading") {
        return;
      }
      if (
        isDownloadStalled({ lastProgressAt: state.lastProgressAt, now: Date.now() })
      ) {
        state.setStalled();
      }
    }, STALL_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [devMock, phase]);

  const retryDownload = useCallback(async () => {
    if (devMock || !isPackaged || updater === null) {
      return;
    }
    useUpdaterStore.getState().retryDownload();
    await runDownloadAndPrepareRestart(updater, depsRef.current);
  }, [devMock, isPackaged, updater]);

  /** Abandon this update entirely; the pill and any toast go away. */
  const cancelUpdate = useCallback(() => {
    if (devMock) {
      writeDevUpdaterMock(null);
      return;
    }
    useUpdaterStore.getState().reset();
  }, [devMock]);

  const skipVersion = useCallback(() => {
    const version = availableVersion;
    if (devMock || version === null) {
      return;
    }
    useUpdaterStore.getState().skipVersion(version);
  }, [availableVersion, devMock]);

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
    await updater.relaunch();
  }, [devMock, isPackaged, updater]);

  useEffect(() => {
    if (!isPackaged || updater === null) {
      return;
    }
    return attachAutoCheckScheduler(updater, depsRef.current);
  }, [isPackaged, updater]);

  return {
    phase,
    availableVersion,
    availableTitle,
    lastCheckedAt,
    errorMessage,
    errorSource,
    downloadProgress,
    downloadReceivedBytes,
    downloadTotalBytes,
    lastProgressAt,
    downloadStartedAt,
    downloadRetryCount,
    checkOrigin,
    restartPromptOpen,
    restartWhenIdle,
    restartCountdownStartedAt,
    manualCheckCompletedAt,
    updatesSupported,
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

export type { UpdaterErrorSource, UpdaterPhase };
export type { UpdaterSchedulerDeps };
