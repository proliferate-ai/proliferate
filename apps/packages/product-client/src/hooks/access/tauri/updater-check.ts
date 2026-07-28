import type { DesktopUpdaterBridge } from "@proliferate/product-client/host/desktop-updater-bridge";
import type { ErrorContext } from "@proliferate/product-client/host/product-host";
import { useUpdaterStore } from "#product/stores/updater/updater-store";
import {
  readPersistedJsonValue,
  readPersistedStringValue,
  writePersistedJson,
  type ProductStorageContext,
} from "#product/lib/infra/persistence/product-storage";
import type { TrackProductEvent } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { normalizeReleaseTitle } from "#product/lib/domain/updates/release-notice";

/**
 * The update *check*, and the schedule it runs on. Sibling of
 * `updater-download.ts`: both are plain module functions driving the shared
 * store, so the hook is left holding only React concerns (store selectors, the
 * dev-mock overlay, and the callbacks it hands to the UI).
 *
 * The schedule is module-level, not per-mount, on purpose — several components
 * call `useUpdater()`, and a per-mount interval would mean N background checks
 * every 30 minutes.
 */

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

export async function runUpdateCheck(
  updater: DesktopUpdaterBridge,
  deps: UpdaterSchedulerDeps,
  options: { userInitiated?: boolean } = {},
): Promise<void> {
  const store = useUpdaterStore.getState();
  if (store.phase === "downloading" || store.phase === "stalled" || checkInFlight) {
    return;
  }
  checkInFlight = true;

  // Recorded before the phase flips, so every consumer of `checking` — the
  // Settings row, the sidebar pill — can already tell whose check this is.
  store.setCheckOrigin(options.userInitiated ? "manual" : "background");
  store.setPhase("checking");
  deps.track("app_update_check_started", undefined);

  try {
    const result = await updater.check();
    const timestamp = new Date().toISOString();
    useUpdaterStore.getState().setChecked(timestamp);
    void persistUpdaterMetadata(deps.storage, { lastCheckedAt: timestamp });

    if (result !== null) {
      // A version the user skipped is not news. It resolves as "nothing to
      // report" so neither the pill nor a toast resurrects it.
      if (useUpdaterStore.getState().skippedVersions.includes(result.version)) {
        useUpdaterStore.getState().setPhase("current");
        if (options.userInitiated) {
          useUpdaterStore.getState().setManualCheckCompleted(Date.now());
        }
        return;
      }
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

/**
 * Reference-counted attach/detach for the background schedule: the first
 * `useUpdater()` mount starts it, the last unmount stops it. Returns the
 * detach function so the caller's effect cleanup stays a one-liner.
 */
export function attachAutoCheckScheduler(
  updater: DesktopUpdaterBridge,
  deps: UpdaterSchedulerDeps,
): () => void {
  autoCheckConsumerCount += 1;
  if (autoCheckConsumerCount === 1 && !stopAutoCheckScheduler) {
    void ensureAutoCheckScheduler(updater, deps);
  }

  return () => {
    autoCheckConsumerCount -= 1;
    if (autoCheckConsumerCount === 0) {
      stopAutoCheckScheduler?.();
    }
  };
}
