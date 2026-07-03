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

// ensureDesktopWorker and teardownDesktopWorker both mutate the single
// physical worker process, but their callers dispatch them fire-and-forget.
// Serialize them on a shared chain so a still-in-flight teardown from a quick
// sign-out cannot kill the worker a subsequent sign-in just ensured (and vice
// versa). Tasks swallow their own errors, so the chain never rejects.
let workerLifecycleChain: Promise<void> = Promise.resolve();

function enqueueWorkerLifecycleTask(task: () => Promise<void>): Promise<void> {
  const run = workerLifecycleChain.then(task, task);
  workerLifecycleChain = run;
  return run;
}

// Ensures a runtime dispatch worker is enrolled for this desktop install
// under the active organization (null for org-less users).
// Runs opportunistically on login; never blocks or throws on failure.
export function ensureDesktopWorker(): Promise<void> {
  return enqueueWorkerLifecycleTask(async () => {
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
  });
}

// Revokes this install's worker + gateway token server-side for the current
// user. Must run while the auth session is still valid — sign-out
// orchestration calls it BEFORE the session is cleared, because once the
// store flips to anonymous the request can only fail with a local 401.
// Best-effort; never blocks or throws.
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

// Local teardown of the desktop worker: stops the worker process and deletes
// the integration-gateway dotfile so local sessions cannot keep using the
// departed identity's integrations. Server-side revocation happens
// separately via revokeDesktopWorkerServerSide (while the auth token is still
// valid) and via the predecessor-retiring enrollment of the next identity.
// Never blocks or throws.
export function teardownDesktopWorker(): Promise<void> {
  return enqueueWorkerLifecycleTask(async () => {
    try {
      await stopDesktopDispatchWorker();
    } catch (error) {
      captureTelemetryException(error, {
        tags: {
          action: "teardown-desktop-worker",
          domain: "cloud",
        },
      });
    }
  });
}
