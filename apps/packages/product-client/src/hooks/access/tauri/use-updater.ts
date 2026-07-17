import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopUpdaterBridge } from "@proliferate/product-client/host/desktop-updater-bridge";
import type { ErrorContext } from "@proliferate/product-client/host/product-host";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useUpdaterStore } from "#product/stores/updater/updater-store";
import {
  readPersistedJsonValue,
  readPersistedStringValue,
  writePersistedJson,
  type ProductStorageContext,
} from "#product/lib/infra/persistence/product-storage";
import type { UpdaterErrorSource, UpdaterPhase } from "#product/stores/updater/updater-store";
import {
  useProductTelemetry,
  type TrackProductEvent,
} from "#product/hooks/telemetry/facade/use-product-telemetry";
import { useProductStorageContext } from "#product/hooks/persistence/facade/use-product-storage-context";
import { normalizeReleaseTitle } from "#product/lib/domain/updates/release-notice";
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

/**
 * The host facades the updater's module-level scheduler needs (ruling G1). The
 * hook — which has host access — arms these; the plain scheduler functions
 * receive them as an explicit argument, mirroring the measurement port. Event
 * names/payloads and the persisted metadata key are byte-identical to the
 * pre-move Desktop hook.
 */
export interface UpdaterSchedulerDeps {
  track: TrackProductEvent;
  captureException: (error: unknown, context?: ErrorContext) => void;
  storage: ProductStorageContext;
}

async function persistUpdaterMetadata(
  storage: ProductStorageContext,
  metadata: UpdaterMetadata,
): Promise<void> {
  await writePersistedJson(storage, UPDATER_METADATA_KEY, metadata);
}

async function loadLastCheckedAt(
  storage: ProductStorageContext,
): Promise<string | null> {
  const metadata = await readPersistedJsonValue<{ lastCheckedAt?: string | null }>(
    storage,
    UPDATER_METADATA_KEY,
  );
  if (metadata?.lastCheckedAt) {
    return metadata.lastCheckedAt;
  }
  // The legacy key stored a bare ISO string (not JSON), so read it as a string.
  return (await readPersistedStringValue(storage, LEGACY_LAST_CHECKED_KEY)) ?? null;
}

async function runUpdateCheck(
  updater: DesktopUpdaterBridge,
  deps: UpdaterSchedulerDeps,
  options: { userInitiated?: boolean } = {},
): Promise<void> {
  const store = useUpdaterStore.getState();
  if (store.phase === "downloading" || checkInFlight) {
    return;
  }
  checkInFlight = true;

  store.setPhase("checking");
  deps.track("app_update_check_started", undefined);

  try {
    const result = await updater.check();
    const timestamp = new Date().toISOString();
    useUpdaterStore.getState().setChecked(timestamp);
    void persistUpdaterMetadata(deps.storage, { lastCheckedAt: timestamp });

    if (result !== null) {
      useUpdaterStore.getState().setAvailable(
        result,
        normalizeReleaseTitle(result.title),
      );
      deps.track("app_update_available", { version: result.version });
    } else {
      useUpdaterStore.getState().setPhase("current");
      if (options.userInitiated) {
        // One-shot "you're up to date" signal. Only manual checks raise it —
        // background checks that find nothing stay silent by design.
        useUpdaterStore.getState().setManualCheckCompleted(Date.now());
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useUpdaterStore.getState().setError(message, "check");
    deps.captureException(error, {
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

async function ensureAutoCheckScheduler(
  updater: DesktopUpdaterBridge,
  deps: UpdaterSchedulerDeps,
): Promise<void> {
  const lastChecked = await loadLastCheckedAt(deps.storage);
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
      void runUpdateCheck(updater, deps);
    }, INITIAL_CHECK_DELAY_MS);
  }

  interval = window.setInterval(() => {
    void runUpdateCheck(updater, deps);
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

    autoCheckConsumerCount += 1;
    if (autoCheckConsumerCount === 1 && !stopAutoCheckScheduler) {
      void ensureAutoCheckScheduler(updater, depsRef.current);
    }

    return () => {
      autoCheckConsumerCount -= 1;
      if (autoCheckConsumerCount === 0) {
        stopAutoCheckScheduler?.();
      }
    };
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
