import { enrollDesktopWorker, revokeDesktopWorker } from "@proliferate/cloud-sdk";
import { getDesktopInstallId } from "@/lib/access/tauri/desktop-install-id";
import {
  ensureDesktopDispatchWorker,
  stopDesktopDispatchWorker,
} from "@/lib/access/tauri/cloud-worker";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { useToastStore } from "@/stores/toast/toast-store";

function describeWorkerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim().length > 0 ? message.trim() : "unknown error";
}

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

// Ensures a runtime dispatch worker is enrolled for this desktop install.
// Runs opportunistically on login; never blocks or throws on failure.
// Resolves true when the worker was ensured and false when it failed (the
// enrollment guard uses this to avoid latching a silent failure forever).
export function ensureDesktopWorker(): Promise<boolean> {
  return enqueueWorkerLifecycleTask(async () => {
    try {
      const desktopInstallId = await getDesktopInstallId();
      const { enrollmentToken } = await enrollDesktopWorker(desktopInstallId);
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
      // The worker backs the integration-gateway MCP, so a silent failure
      // strands local sessions without their integrations. Surface the cause
      // (the Tauri command now appends the worker's crash log tail to its error)
      // so a stale-binary / enroll-contract mismatch is visible instead of only
      // landing in telemetry.
      useToastStore
        .getState()
        .show(`Cloud integrations worker failed to start: ${describeWorkerError(error)}`, "error");
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

// Local teardown of the desktop worker on sign-out: stops the worker process
// and deletes the integration-gateway dotfile so local sessions cannot keep
// using the departed user's integrations. Server-side revocation happens
// separately via revokeDesktopWorkerServerSide (while the auth token is still
// valid) and via the predecessor-retiring enrollment of the next user. Never
// blocks or throws.
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
