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
import { readUpdaterFlags } from "#product/hooks/access/tauri/updater-flags";

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
export const CHECK_INTERVAL_MS = 1_800_000; // 30 minutes
const UPDATER_METADATA_KEY = "updater_metadata";
const LEGACY_LAST_CHECKED_KEY = "updater_lastCheckedAt";

let checkInFlight = false;
let autoCheckConsumerCount = 0;
let stopAutoCheckScheduler: (() => void) | null = null;

/**
 * The persisted updater metadata, written additively on the existing
 * `updater_metadata` key. `skippedVersions` is what makes a skip survive a
 * relaunch; `staged` records the last verified staged artifact so a boot can
 * reuse it (or clean it when it no longer matches the offered version).
 */
interface UpdaterMetadata {
  lastCheckedAt: string | null;
  skippedVersions?: string[];
  availableVersion?: string | null;
  staged?: { version: string; sha256: string } | null;
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
  /**
   * Endpoint override candidate for the owned check: the connected non-official
   * server's `/desktop/updater/latest.json`, or null on the default hosted
   * feed. Only used when the `updaterServerRedirectEnabled` flag is ON; any
   * failure falls back to the baked feed.
   */
  serverUpdaterEndpoint?: string | null;
  /** Optional cadence override (ms) from `/meta`; null/absent keeps the default. */
  checkIntervalMsOverride?: number | null;
}

/**
 * Read the current store state and write the full metadata snapshot. Additive:
 * every field is derived from live state, so a write never drops the skip list
 * or the staged pointer. Best-effort (product storage swallows write failures).
 */
export async function persistUpdaterMetadataSnapshot(
  storage: ProductStorageContext,
  overrides: Partial<UpdaterMetadata> = {},
): Promise<void> {
  const state = useUpdaterStore.getState();
  const metadata: UpdaterMetadata = {
    lastCheckedAt: state.lastCheckedAt,
    skippedVersions: state.skippedVersions,
    availableVersion: state.availableVersion,
    ...overrides,
  };
  await writePersistedJson(storage, UPDATER_METADATA_KEY, metadata);
}

async function loadUpdaterMetadata(
  storage: ProductStorageContext,
): Promise<UpdaterMetadata> {
  const metadata = await readPersistedJsonValue<UpdaterMetadata>(
    storage,
    UPDATER_METADATA_KEY,
  );
  if (metadata && typeof metadata === "object") {
    return metadata;
  }
  // The legacy key stored a bare ISO string (not JSON), so read it as a string.
  const legacy = (await readPersistedStringValue(storage, LEGACY_LAST_CHECKED_KEY)) ?? null;
  return { lastCheckedAt: legacy };
}

export async function runUpdateCheck(
  updater: DesktopUpdaterBridge,
  deps: UpdaterSchedulerDeps,
  options: { userInitiated?: boolean } = {},
): Promise<void> {
  const store = useUpdaterStore.getState();
  if (
    store.phase === "downloading" ||
    store.phase === "stalled" ||
    store.phase === "verifying" ||
    store.phase === "reusingStaged" ||
    checkInFlight
  ) {
    return;
  }
  checkInFlight = true;

  // Recorded before the phase flips, so every consumer of `checking` — the
  // Settings row, the sidebar update button — can already tell whose check
  // this is.
  store.setCheckOrigin(options.userInitiated ? "manual" : "background");
  store.setPhase("checking");
  deps.track("app_update_check_started", undefined);

  try {
    const flags = await readUpdaterFlags(deps.storage);
    const useOwned =
      flags.ownedUpdaterEnabled && typeof updater.checkOwned === "function";
    // Redirect override only when its flag is ON and a non-official server is
    // connected. Any owned-check failure below falls back to the baked feed.
    const endpointOverride =
      flags.updaterServerRedirectEnabled && deps.serverUpdaterEndpoint
        ? deps.serverUpdaterEndpoint
        : undefined;

    const result = await runCheckOnce(updater, useOwned, endpointOverride);
    const timestamp = new Date().toISOString();
    useUpdaterStore.getState().setChecked(timestamp);
    void persistUpdaterMetadataSnapshot(deps.storage, { lastCheckedAt: timestamp });

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
      void persistUpdaterMetadataSnapshot(deps.storage);

      // Idempotence across restarts: if this exact version is already staged
      // and verified, there is nothing to download. Announce reuse and let the
      // download hook flip to ready.
      if (useOwned && typeof updater.stagedStatus === "function") {
        try {
          const staged = await updater.stagedStatus(result.version);
          if (staged && staged.version === result.version) {
            useUpdaterStore.getState().setPhase("reusingStaged");
            void persistUpdaterMetadataSnapshot(deps.storage, {
              staged: { version: staged.version, sha256: staged.sha256 },
            });
          }
        } catch (error) {
          // A staged-status probe failure is non-fatal: fall through to a
          // normal download.
          deps.captureException(error, {
            tags: { action: "staged_status", domain: "updater", route: "settings" },
          });
        }
      }
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

/**
 * Run a single check via the owned path (native builder, endpoint override, and
 * the baked pubkey still verifying) when enabled, else the legacy plugin check.
 * The owned check falls back to the baked feed when an endpoint override fails.
 */
async function runCheckOnce(
  updater: DesktopUpdaterBridge,
  useOwned: boolean,
  endpointOverride: string | undefined,
): Promise<Awaited<ReturnType<DesktopUpdaterBridge["check"]>>> {
  if (useOwned && typeof updater.checkOwned === "function") {
    if (endpointOverride) {
      try {
        return await updater.checkOwned(endpointOverride);
      } catch {
        // Redirect endpoint failed — fall back to the baked feed.
        return await updater.checkOwned();
      }
    }
    return await updater.checkOwned();
  }
  return await updater.check();
}

async function ensureAutoCheckScheduler(
  updater: DesktopUpdaterBridge,
  deps: UpdaterSchedulerDeps,
): Promise<void> {
  const metadata = await loadUpdaterMetadata(deps.storage);
  const lastChecked = metadata.lastCheckedAt ?? null;
  if (lastChecked) {
    useUpdaterStore.getState().setChecked(lastChecked);
  }
  // Skips must survive relaunch: seed the store's skip list from persistence
  // before any check can announce a version the user already dismissed.
  if (metadata.skippedVersions && metadata.skippedVersions.length > 0) {
    useUpdaterStore.getState().hydrateSkippedVersions(metadata.skippedVersions);
  }

  const elapsed = lastChecked
    ? Date.now() - new Date(lastChecked).getTime()
    : Infinity;

  const checkIntervalMs =
    typeof deps.checkIntervalMsOverride === "number" &&
    Number.isFinite(deps.checkIntervalMsOverride) &&
    deps.checkIntervalMsOverride > 0
      ? deps.checkIntervalMsOverride
      : CHECK_INTERVAL_MS;

  let timeout: number | null = null;
  let interval: number | null = null;

  if (elapsed >= checkIntervalMs) {
    timeout = window.setTimeout(() => {
      void runUpdateCheck(updater, deps);
    }, INITIAL_CHECK_DELAY_MS);
  }

  interval = window.setInterval(() => {
    void runUpdateCheck(updater, deps);
  }, checkIntervalMs);

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
