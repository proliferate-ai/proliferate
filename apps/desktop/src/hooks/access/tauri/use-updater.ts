import { useCallback, useEffect, useState } from "react";
import { useUpdaterStore } from "@/stores/updater/updater-store";
import {
  persistValue,
  readPersistedValue,
} from "@/lib/infra/persistence/preferences-persistence";
import type { UpdaterErrorSource, UpdaterPhase } from "@/stores/updater/updater-store";
import {
  checkForUpdate,
  downloadAndInstall,
  relaunch,
  isTauriPackaged,
} from "@/lib/access/tauri/updater";
import {
  trackProductEvent,
  captureTelemetryException,
} from "@/lib/integrations/telemetry/client";
import { classifyTelemetryFailure } from "@/lib/domain/telemetry/failures";
import { normalizeReleaseTitle } from "@/lib/domain/updates/release-notice";
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

const INITIAL_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 1_800_000; // 30 minutes
const UPDATER_METADATA_KEY = "updater_metadata";
const LEGACY_LAST_CHECKED_KEY = "updater_lastCheckedAt";

let checkInFlight = false;
let autoCheckConsumerCount = 0;
let stopAutoCheckScheduler: (() => void) | null = null;

interface UpdaterMetadata {
  lastCheckedAt: string | null;
}

async function persistUpdaterMetadata(metadata: UpdaterMetadata): Promise<void> {
  await persistValue(UPDATER_METADATA_KEY, metadata);
}

async function loadLastCheckedAt(): Promise<string | null> {
  const metadata = await readPersistedValue<{ lastCheckedAt?: string | null }>(
    UPDATER_METADATA_KEY,
  );
  if (metadata?.lastCheckedAt) {
    return metadata.lastCheckedAt;
  }
  return (await readPersistedValue<string>(LEGACY_LAST_CHECKED_KEY)) ?? null;
}

async function runUpdateCheck(options: { userInitiated?: boolean } = {}): Promise<void> {
  const store = useUpdaterStore.getState();
  if (store.phase === "downloading" || checkInFlight) {
    return;
  }
  checkInFlight = true;

  store.setPhase("checking");
  trackProductEvent("app_update_check_started", undefined);

  try {
    const result = await checkForUpdate();
    const timestamp = new Date().toISOString();
    useUpdaterStore.getState().setChecked(timestamp);
    void persistUpdaterMetadata({ lastCheckedAt: timestamp });

    if (result.kind === "available") {
      useUpdaterStore.getState().setAvailable(
        result.version,
        result.update,
        normalizeReleaseTitle(result.title),
      );
      trackProductEvent("app_update_available", { version: result.version });
    } else if (result.kind === "current") {
      useUpdaterStore.getState().setPhase("current");
      if (options.userInitiated) {
        // One-shot "you're up to date" signal. Only manual checks raise it —
        // background checks that find nothing stay silent by design.
        useUpdaterStore.getState().setManualCheckCompleted(Date.now());
      }
    } else {
      useUpdaterStore.getState().setError(result.message, "check");
      captureTelemetryException(new Error(result.message), {
        tags: {
          action: "check_for_update",
          domain: "updater",
          route: "settings",
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useUpdaterStore.getState().setError(message, "check");
    captureTelemetryException(error, {
      tags: {
        action: "check_for_update",
        domain: "updater",
        route: "settings",
      },
    });
  } finally {
    checkInFlight = false;
  }
}

async function runDownloadAndPrepareRestart(): Promise<void> {
  const store = useUpdaterStore.getState();
  const handle = store._updateHandle;
  const version = store.availableVersion;
  if (!handle) {
    return;
  }

  store.setPhase("downloading");
  store.setDownloadProgress(0);
  trackProductEvent("app_update_download_started", { version });

  try {
    let totalReceived = 0;
    await downloadAndInstall(handle, (chunkLength, contentLength) => {
      totalReceived += chunkLength;
      if (contentLength && contentLength > 0) {
        const pct = Math.min(100, Math.round((totalReceived / contentLength) * 100));
        useUpdaterStore.getState().setDownloadProgress(pct);
      }
    });

    useUpdaterStore.getState().setReady();
    trackProductEvent("app_update_install_succeeded", { version });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useUpdaterStore.getState().setError(message, "download");
    trackProductEvent("app_update_install_failed", {
      failure_kind: classifyTelemetryFailure(error),
      version,
    });
    captureTelemetryException(error, {
      tags: {
        action: "download_and_relaunch",
        domain: "updater",
        route: "settings",
      },
    });
  }
}

async function ensureAutoCheckScheduler(): Promise<void> {
  const lastChecked = await loadLastCheckedAt();
  if (lastChecked) {
    useUpdaterStore.getState().setChecked(lastChecked);
  }

  const elapsed = lastChecked
    ? Date.now() - new Date(lastChecked).getTime()
    : Infinity;

  let timeout: number | null = null;
  let interval: number | null = null;

  if (elapsed >= CHECK_INTERVAL_MS) {
    timeout = window.setTimeout(() => {
      void runUpdateCheck();
    }, INITIAL_CHECK_DELAY_MS);
  }

  interval = window.setInterval(() => {
    void runUpdateCheck();
  }, CHECK_INTERVAL_MS);

  stopAutoCheckScheduler = () => {
    if (timeout) {
      window.clearTimeout(timeout);
      timeout = null;
    }
    if (interval) {
      window.clearInterval(interval);
      interval = null;
    }
    stopAutoCheckScheduler = null;
  };
}

export function useUpdater() {
  const storePhase = useUpdaterStore((s) => s.phase);
  const storeAvailableVersion = useUpdaterStore((s) => s.availableVersion);
  const storeAvailableTitle = useUpdaterStore((s) => s.availableTitle);
  const storeLastCheckedAt = useUpdaterStore((s) => s.lastCheckedAt);
  const storeErrorMessage = useUpdaterStore((s) => s.errorMessage);
  const storeErrorSource = useUpdaterStore((s) => s.errorSource);
  const storeDownloadProgress = useUpdaterStore((s) => s.downloadProgress);
  const storeRestartPromptOpen = useUpdaterStore((s) => s.restartPromptOpen);
  const storeRestartWhenIdle = useUpdaterStore((s) => s.restartWhenIdle);
  const storeManualCheckCompletedAt = useUpdaterStore((s) => s.manualCheckCompletedAt);
  const isPackaged = isTauriPackaged();
  const [devMock, setDevMock] = useState<DevUpdaterMockState | null>(() => readDevUpdaterMock());

  const phase = devMock?.phase ?? storePhase;
  const availableVersion = devMock?.version ?? storeAvailableVersion;
  const availableTitle = devMock
    ? devMock.title ?? null
    : storeAvailableTitle;
  const lastCheckedAt = devMock?.lastCheckedAt ?? storeLastCheckedAt;
  const errorMessage = devMock?.errorMessage ?? storeErrorMessage;
  const errorSource = devMock ? devMock.errorSource : storeErrorSource;
  const downloadProgress = devMock?.downloadProgress ?? storeDownloadProgress;
  const restartPromptOpen = devMock?.restartPromptOpen ?? storeRestartPromptOpen;
  const restartWhenIdle = devMock ? devMock.restartWhenIdle : storeRestartWhenIdle;
  const manualCheckCompletedAt = devMock
    ? devMock.manualCheckCompletedAt
    : storeManualCheckCompletedAt;
  const updatesSupported = isPackaged || devMock !== null;

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

    if (!isPackaged) {
      return;
    }
    await runUpdateCheck({ userInitiated: true });
  }, [devMock, isPackaged]);

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

    if (!isPackaged) {
      return;
    }
    await runDownloadAndPrepareRestart();
  }, [devMock, isPackaged]);

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

    if (!isPackaged) {
      return;
    }
    useUpdaterStore.getState().setRestartPromptOpen(false);
    await relaunch();
  }, [devMock, isPackaged]);

  useEffect(() => {
    if (!isPackaged) {
      return;
    }

    autoCheckConsumerCount += 1;
    if (autoCheckConsumerCount === 1 && !stopAutoCheckScheduler) {
      void ensureAutoCheckScheduler();
    }

    return () => {
      autoCheckConsumerCount -= 1;
      if (autoCheckConsumerCount === 0) {
        stopAutoCheckScheduler?.();
      }
    };
  }, [isPackaged]);

  return {
    phase,
    availableVersion,
    availableTitle,
    lastCheckedAt,
    errorMessage,
    errorSource,
    downloadProgress,
    restartPromptOpen,
    restartWhenIdle,
    manualCheckCompletedAt,
    updatesSupported,
    checkNow,
    clearManualCheckCompleted,
    downloadUpdate,
    openRestartPrompt,
    closeRestartPrompt,
    scheduleRestartWhenIdle,
    restartNow,
  };
}

export type { UpdaterErrorSource, UpdaterPhase };
