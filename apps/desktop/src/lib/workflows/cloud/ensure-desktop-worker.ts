import { enrollDesktopWorker, revokeDesktopWorker } from "@proliferate/cloud-sdk";
import { getDesktopInstallId } from "@/lib/access/tauri/desktop-install-id";
import {
  ensureDesktopDispatchWorker,
  stopDesktopDispatchWorker,
} from "@/lib/access/tauri/cloud-worker";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";

// Ensures a runtime dispatch worker is enrolled for this desktop install.
// Runs opportunistically on login; never blocks or throws on failure.
export async function ensureDesktopWorker(): Promise<void> {
  try {
    const desktopInstallId = await getDesktopInstallId();
    const { enrollmentToken } = await enrollDesktopWorker(desktopInstallId);
    await ensureDesktopDispatchWorker({
      targetId: desktopInstallId,
      enrollmentToken,
    });
  } catch (error) {
    captureTelemetryException(error, {
      tags: {
        action: "ensure-desktop-worker",
        domain: "cloud",
      },
    });
  }
}

// Tears down the desktop worker on sign-out: best-effort server-side revoke
// (the auth token may already be gone, so failures are swallowed), then stops
// the local worker process and deletes the integration-gateway dotfile so
// local sessions cannot keep using the departed user's integrations. Never
// blocks or throws.
export async function teardownDesktopWorker(): Promise<void> {
  try {
    const desktopInstallId = await getDesktopInstallId();
    try {
      await revokeDesktopWorker(desktopInstallId);
    } catch (error) {
      captureTelemetryException(error, {
        tags: {
          action: "revoke-desktop-worker",
          domain: "cloud",
        },
      });
    }
    await stopDesktopDispatchWorker();
  } catch (error) {
    captureTelemetryException(error, {
      tags: {
        action: "teardown-desktop-worker",
        domain: "cloud",
      },
    });
  }
}
