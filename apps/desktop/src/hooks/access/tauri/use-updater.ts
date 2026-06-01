import { useCallback, useEffect, useState } from "react";
import { useUpdaterStore } from "@/stores/updater/updater-store";
import {
  persistValue,
  readPersistedValue,
} from "@/lib/infra/persistence/preferences-persistence";
import type { UpdaterPhase } from "@/stores/updater/updater-store";
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
import {
  clearDevUpdaterMockDownload,
  DEV_UPDATER_MOCK_EVENT,
  isDevUpdaterMockSupported,
  readDevUpdaterMock,
  startDevUpdaterMockDownload,
  updateDevUpdaterMock,
  writeDevUpdaterMock,
  type DevUpdaterMockState,
} from "./updater-dev-mock";

const INITIAL_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 21_600_000; // 6 hours
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

async function runUpdateCheck(): Promise<void> {
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
      useUpdaterStore.getState().setAvailable(result.version, result.update);
      trackProductEvent("app_update_available", { version: result.version });
    } else if (result.kind === "current") {
      useUpdaterStore.getState().setPhase("current");
    } else {
      useUpdaterStore.getState().setError(result.message);
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
    useUpdaterStore.getState().setError(message);
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
    useUpdaterStore.getState().setError(message);
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
  const storeLastCheckedAt = useUpdaterStore((s) => s.lastCheckedAt);
  const storeErrorMessage = useUpdaterStore((s) => s.errorMessage);
  const storeDownloadProgress = useUpdaterStore((s) => s.downloadProgress);
  const storeRestartPromptOpen = useUpdaterStore((s) => s.restartPromptOpen);
  const isPackaged = isTauriPackaged();
  const [devMock, setDevMock] = useState<DevUpdaterMockState | null>(() => readDevUpdaterMock());

  const phase = devMock?.phase ?? storePhase;
  const availableVersion = devMock?.version ?? storeAvailableVersion;
  const lastCheckedAt = devMock?.lastCheckedAt ?? storeLastCheckedAt;
  const errorMessage = devMock?.errorMessage ?? storeErrorMessage;
  const downloadProgress = devMock?.downloadProgress ?? storeDownloadProgress;
  const restartPromptOpen = devMock?.restartPromptOpen ?? storeRestartPromptOpen;
  const updatesSupported = isPackaged || devMock !== null;

  useEffect(() => {
    if (!isDevUpdaterMockSupported()) {
      return;
    }

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
      updateDevUpdaterMock((current) =>
        current ? { ...current, lastCheckedAt: timestamp } : current,
      );
      return;
    }

    if (!isPackaged) {
      return;
    }
    await runUpdateCheck();
  }, [devMock, isPackaged]);

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
    lastCheckedAt,
    errorMessage,
    downloadProgress,
    restartPromptOpen,
    updatesSupported,
    checkNow,
    downloadUpdate,
    openRestartPrompt,
    closeRestartPrompt,
    restartNow,
  };
}

export type { UpdaterPhase };
