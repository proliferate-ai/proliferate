import { useEffect, useMemo, useRef, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useUpdaterStore } from "#product/stores/updater/updater-store";
import type { UpdaterErrorSource, UpdaterPhase } from "#product/stores/updater/updater-store";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { useProductStorageContext } from "#product/hooks/persistence/facade/use-product-storage-context";
import {
  DEV_UPDATER_MOCK_EVENT,
  isDevUpdaterMockSupported,
  readDevUpdaterMock,
  seedDevUpdaterMockFromEnv,
  type DevUpdaterMockState,
} from "./updater-dev-mock";
import {
  attachAutoCheckScheduler,
  type UpdaterSchedulerDeps,
} from "./updater-check";
import { useUpdaterActions } from "./use-updater-actions";
import { isDownloadStalled } from "#product/lib/domain/updates/download-stall";
import { isOfficialHostedApiBaseUrl } from "#product/lib/infra/proliferate-api";

/** How often the stall clock is read. Well under the 8s threshold it tests. */
const STALL_POLL_INTERVAL_MS = 1_000;

export function useUpdater() {
  const host = useProductHost();
  const updater = host.desktop?.updater ?? null;
  const telemetry = useProductTelemetry();
  const storageContext = useProductStorageContext();
  const apiBaseUrl = host.deployment?.apiBaseUrl ?? null;
  // The owned check's endpoint-override candidate: a connected non-official
  // server's redirect manifest. Only consumed when the redirect flag is ON.
  const serverUpdaterEndpoint = useMemo<string | null>(() => {
    if (!apiBaseUrl || isOfficialHostedApiBaseUrl(apiBaseUrl)) {
      return null;
    }
    return `${apiBaseUrl.replace(/\/$/, "")}/desktop/updater/latest.json`;
  }, [apiBaseUrl]);
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
      serverUpdaterEndpoint,
    }),
    [telemetry, storageContext, serverUpdaterEndpoint],
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
  const downloadStartedAt = devMock
    ? devMock.downloadStartedAt
    : storeDownloadStartedAt;
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

  const {
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
  } = useUpdaterActions({ devMock, isPackaged, updater, depsRef, availableVersion });

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
