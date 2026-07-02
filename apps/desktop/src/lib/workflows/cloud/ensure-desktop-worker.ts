import { enrollDesktopWorker, revokeDesktopWorker } from "@proliferate/cloud-sdk";
import { getDesktopInstallId } from "@/lib/access/tauri/desktop-install-id";
import {
  ensureDesktopDispatchWorker,
  stopDesktopDispatchWorker,
} from "@/lib/access/tauri/cloud-worker";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { useOrganizationStore } from "@/stores/organizations/organization-store";

// The organization the worker identity should be minted under. Read at call
// time from the organization store (the non-React accessor, mirroring how
// owner-context headers read it). Unlike request headers we do not require
// the validated flag: the server membership-validates the organization on
// enrollment anyway, and waiting for validation would enroll org-less first
// and then re-enroll once the organizations query resolves on every cold
// start. A stale selection 404s server-side and the (user, org) guard
// re-enrolls once the selection lifecycle falls back to a real membership.
export function getEnrollmentOrganizationId(): string | null {
  return useOrganizationStore.getState().activeOrganizationId;
}

// Ensures a runtime dispatch worker is enrolled for this desktop install
// under the active organization (null for org-less users).
// Runs opportunistically on login; never blocks or throws on failure.
export async function ensureDesktopWorker(): Promise<void> {
  try {
    const desktopInstallId = await getDesktopInstallId();
    const { enrollmentToken } = await enrollDesktopWorker(
      desktopInstallId,
      getEnrollmentOrganizationId(),
    );
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
