import { enrollDesktopWorker, revokeDesktopWorker } from "@proliferate/cloud-sdk";
import { getDesktopInstallId } from "@/lib/access/tauri/desktop-install-id";
import {
  ensureDesktopDispatchWorker,
  stopDesktopDispatchWorker,
} from "@/lib/access/tauri/cloud-worker";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";

// ensureDesktopWorker and teardownDesktopWorker both mutate the single
// physical worker process, but their callers dispatch them fire-and-forget.
// Serialize them on a shared chain so a still-in-flight teardown from a quick
// sign-out cannot kill the worker a subsequent sign-in just ensured (and vice
// versa). Tasks swallow their own errors, so the chain never rejects.
let workerLifecycleChain: Promise<unknown> = Promise.resolve();

function enqueueWorkerLifecycleTask<T>(task: () => Promise<T>): Promise<T> {
  const run = workerLifecycleChain.then(task, task);
  workerLifecycleChain = run;
  return run;
}

// Ensures a runtime dispatch worker is enrolled for this desktop install
// under the given organization (null for org-less users). The caller passes
// the organization it decided to enroll for — the enrollment guard's effect
// captures it — instead of this workflow re-reading the store after an await,
// so the enrolled org provably matches the guard's identity key even when the
// active organization changes mid-flight.
// Runs opportunistically on login; never blocks or throws on failure.
// Resolves false when enrollment failed so the guard can retry.
export function ensureDesktopWorker(organizationId: string | null): Promise<boolean> {
  return enqueueWorkerLifecycleTask(async () => {
    try {
      const desktopInstallId = await getDesktopInstallId();
      const { enrollmentToken } = await enrollDesktopWorker(
        desktopInstallId,
        organizationId,
      );
      await ensureDesktopDispatchWorker({
        targetId: desktopInstallId,
        enrollmentToken,
      });
      return true;
    } catch (error) {
      captureTelemetryException(error, {
        tags: {
          action: "ensure-desktop-worker",
          domain: "cloud",
        },
      });
      return false;
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
