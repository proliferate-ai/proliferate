import type { DesktopUpdaterBridge } from "@proliferate/product-client/host/desktop-updater-bridge";
import type { ErrorContext } from "@proliferate/product-client/host/product-host";
import type { TrackProductEvent } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { classifyTelemetryFailure } from "#product/lib/domain/telemetry/failures";
import { useUpdaterStore } from "#product/stores/updater/updater-store";
import {
  persistUpdaterMetadataSnapshot,
  type UpdaterSchedulerDeps,
} from "#product/hooks/access/tauri/updater-check";

interface UpdaterDownloadDeps {
  track: TrackProductEvent;
  captureException: (error: unknown, context?: ErrorContext) => void;
}

/** The typed native code an owned abort surfaces (see updater_owned.rs). */
const ABORTED_CODE = "UPDATER_DOWNLOAD_ABORTED";

/**
 * Abort any in-flight owned download and await the native ack. Retries and a
 * cancel MUST call this before starting a new download or resetting, so there
 * is never more than one live download. No-op when the bridge lacks the owned
 * cancel method (legacy path).
 */
export async function abortOwnedDownload(
  updater: DesktopUpdaterBridge,
): Promise<void> {
  if (typeof updater.cancelDownload === "function") {
    try {
      await updater.cancelDownload();
    } catch {
      // Abort is best-effort: a failed ack must not block recovery.
    }
  }
}

/**
 * Drive a download to `ready`. In the owned path the bytes are streamed to a
 * staged file and verified (sha256 + minisign) natively; `ready` means staged +
 * verified, and the install itself runs at restart. When the flow is already in
 * `reusingStaged` (a verified artifact for this version was found at check
 * time), there is nothing to download — it goes straight to `ready`.
 *
 * The legacy path is preserved exactly: `downloadAndInstall` both downloads and
 * installs, and `ready` means installed.
 */
export async function runDownloadAndPrepareRestart(
  updater: DesktopUpdaterBridge,
  deps: UpdaterDownloadDeps,
  options: { owned: boolean; storage?: UpdaterSchedulerDeps["storage"] } = {
    owned: false,
  },
): Promise<void> {
  const store = useUpdaterStore.getState();
  const update = store._update;
  const version = update?.version ?? null;
  if (!update) {
    return;
  }

  const owned = options.owned && typeof updater.downloadOwned === "function";

  // Reuse: the artifact for this version is already staged and verified.
  if (store.phase === "reusingStaged" && owned) {
    useUpdaterStore.getState().setReady();
    deps.track("app_update_download_started", { version });
    deps.track("app_update_install_succeeded", { version });
    return;
  }

  store.setPhase("downloading");
  store.setDownloadProgress({ receivedBytes: 0, totalBytes: null });
  deps.track("app_update_download_started", { version });

  try {
    if (owned && typeof updater.downloadOwned === "function") {
      const staged = await updater.downloadOwned(update, (progress) => {
        useUpdaterStore.getState().setDownloadProgress(progress);
        // Bytes are all in; the native side is now recomputing sha256 +
        // re-checking minisign. Naming the phase is what lets the surface say
        // "verifying" instead of a stuck 100% bar.
        if (
          progress.totalBytes !== null &&
          progress.totalBytes > 0 &&
          progress.receivedBytes >= progress.totalBytes
        ) {
          useUpdaterStore.getState().setPhase("verifying");
        }
      });

      useUpdaterStore.getState().setReady();
      if (options.storage) {
        void persistUpdaterMetadataSnapshot(options.storage, {
          staged: { version: staged.version, sha256: staged.sha256 },
        });
      }
      deps.track("app_update_install_succeeded", { version });
      return;
    }

    await updater.downloadAndInstall(update, (progress) => {
      useUpdaterStore.getState().setDownloadProgress(progress);
    });

    useUpdaterStore.getState().setReady();
    deps.track("app_update_install_succeeded", { version });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // An abort is a deliberate user action (retry/cancel), not a failure — the
    // caller drives the next phase, so we do not paint an error.
    if (message.includes(ABORTED_CODE)) {
      return;
    }
    useUpdaterStore.getState().setError(message, "download");
    deps.track("app_update_install_failed", {
      failure_kind: classifyTelemetryFailure(error),
      version,
    });
    deps.captureException(error, {
      tags: {
        action: "download_and_relaunch",
        domain: "updater",
        route: "settings",
      },
    });
  }
}
