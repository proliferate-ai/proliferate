import { buildProliferateApiUrl } from "@/lib/infra/proliferate-api";
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
  summarizeStartupError,
} from "@/lib/infra/measurement/debug-startup";

let lastKnownControlPlaneReachable: boolean | null = null;
const CONTROL_PLANE_HEALTH_TIMEOUT_MS = 2_500;
type HealthCheckResult =
  | { kind: "response"; response: Response }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" };

export function getLastKnownControlPlaneReachable(): boolean | null {
  return lastKnownControlPlaneReachable;
}

export async function checkControlPlaneReachable(): Promise<boolean> {
  const startedAt = startStartupTimer();
  logStartupDebug("control_plane.health.start");
  const abortController = typeof AbortController !== "undefined"
    ? new AbortController()
    : null;
  let timedOut = false;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeoutPromise = new Promise<HealthCheckResult>((resolve) => {
    timeoutId = globalThis.setTimeout(() => {
      timedOut = true;
      abortController?.abort();
      resolve({ kind: "timeout" });
    }, CONTROL_PLANE_HEALTH_TIMEOUT_MS);
  });

  const fetchPromise = fetch(buildProliferateApiUrl("/health"), {
    headers: {
      Accept: "application/json",
    },
    signal: abortController?.signal,
  })
    .then((response): HealthCheckResult => ({ kind: "response", response }))
    .catch((error): HealthCheckResult => ({ kind: "error", error }));

  try {
    // WebKitGTK can leave failed localhost fetches pending after abort. Race the
    // request against an explicit timeout so desktop boot can still continue.
    const result = await Promise.race([fetchPromise, timeoutPromise]);
    if (result.kind === "timeout") {
      lastKnownControlPlaneReachable = false;
      logStartupDebug("control_plane.health.failed", {
        elapsedMs: elapsedStartupMs(startedAt),
        timedOut: true,
        timeoutMs: CONTROL_PLANE_HEALTH_TIMEOUT_MS,
      });
      return false;
    }
    if (result.kind === "error") {
      throw result.error;
    }

    const { response } = result;
    const reachable = response.ok;
    lastKnownControlPlaneReachable = reachable;
    logStartupDebug("control_plane.health.completed", {
      elapsedMs: elapsedStartupMs(startedAt),
      reachable,
      status: response.status,
    });
    return reachable;
  } catch (error) {
    lastKnownControlPlaneReachable = false;
    logStartupDebug("control_plane.health.failed", {
      elapsedMs: elapsedStartupMs(startedAt),
      timedOut,
      timeoutMs: CONTROL_PLANE_HEALTH_TIMEOUT_MS,
      ...summarizeStartupError(error),
    });
    return false;
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}
