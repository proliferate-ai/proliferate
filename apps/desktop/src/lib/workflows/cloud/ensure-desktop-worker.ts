import { enrollDesktopWorker } from "@proliferate/cloud-sdk";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type { DesktopWorkerBridge } from "@proliferate/product-client/host/desktop-bridge";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";

// ensureDesktopWorker and teardownDesktopWorker both mutate the single
// physical worker process, but their callers dispatch them fire-and-forget.
// Serialize them on a shared chain so a still-in-flight teardown from a quick
// sign-out cannot kill the worker a subsequent sign-in just ensured (and vice
// versa). Tasks swallow their own errors, so the chain never rejects.
let workerLifecycleChain: Promise<unknown> = Promise.resolve();

export interface EnsureDesktopWorkerDeps {
  onFailure: (error: unknown) => void;
}

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
export function ensureDesktopWorker(
  organizationId: string | null,
  worker: DesktopWorkerBridge,
  cloudClient: ProliferateCloudClient,
  deps: EnsureDesktopWorkerDeps,
): Promise<boolean> {
  return enqueueWorkerLifecycleTask(async () => {
    try {
      const desktopInstallId = await worker.getInstallId();
      const { enrollmentToken } = await enrollDesktopWorker(
        desktopInstallId,
        organizationId,
        cloudClient,
      );
      await worker.ensure({
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
      try {
        deps.onFailure(error);
      } catch (notificationError) {
        captureTelemetryException(notificationError, {
          tags: {
            action: "notify-desktop-worker-failure",
            domain: "cloud",
          },
        });
      }
      return false;
    }
  });
}

// Local teardown of the desktop worker: stops the worker process and deletes
// the integration-gateway dotfile so local sessions cannot keep using the
// departed identity's integrations. Server-side revocation happens
// separately in Desktop auth transport (while the auth token is still valid)
// and via the predecessor-retiring enrollment of the next identity.
// Never blocks or throws.
export function teardownDesktopWorker(worker: DesktopWorkerBridge): Promise<void> {
  return enqueueWorkerLifecycleTask(async () => {
    try {
      await worker.stop();
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
