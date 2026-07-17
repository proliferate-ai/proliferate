import type { DesktopUpdaterBridge } from "@proliferate/product-client/host/desktop-updater-bridge";
import type { ErrorContext } from "@proliferate/product-client/host/product-host";
import type { TrackProductEvent } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { classifyTelemetryFailure } from "#product/lib/domain/telemetry/failures";
import { useUpdaterStore } from "#product/stores/updater/updater-store";

interface UpdaterDownloadDeps {
  track: TrackProductEvent;
  captureException: (error: unknown, context?: ErrorContext) => void;
}

export async function runDownloadAndPrepareRestart(
  updater: DesktopUpdaterBridge,
  deps: UpdaterDownloadDeps,
): Promise<void> {
  const store = useUpdaterStore.getState();
  const update = store._update;
  const version = update?.version ?? null;
  if (!update) {
    return;
  }

  store.setPhase("downloading");
  store.setDownloadProgress({ receivedBytes: 0, totalBytes: null });
  deps.track("app_update_download_started", { version });

  try {
    await updater.downloadAndInstall(update, (progress) => {
      useUpdaterStore.getState().setDownloadProgress(progress);
    });

    useUpdaterStore.getState().setReady();
    deps.track("app_update_install_succeeded", { version });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
