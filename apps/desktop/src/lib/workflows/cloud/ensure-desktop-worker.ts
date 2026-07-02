import { enrollDesktopWorker } from "@proliferate/cloud-sdk";
import { getDesktopInstallId } from "@/lib/access/tauri/desktop-install-id";
import { ensureDesktopDispatchWorker } from "@/lib/access/tauri/cloud-worker";
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
