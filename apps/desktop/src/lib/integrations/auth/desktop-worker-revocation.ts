import { revokeDesktopWorker } from "@proliferate/cloud-sdk";

import { getDesktopInstallId } from "@/lib/access/tauri/desktop-install-id";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";

// Desktop auth transport owns server-side revocation because it must run while
// the current auth session is still valid, before logout clears that authority.
export async function revokeDesktopWorkerServerSide(): Promise<void> {
  try {
    const desktopInstallId = await getDesktopInstallId();
    await revokeDesktopWorker(desktopInstallId);
  } catch (error) {
    captureTelemetryException(error, {
      tags: {
        action: "revoke-desktop-worker",
        domain: "cloud",
      },
    });
  }
}
