import { buildProliferateApiUrl } from "#product/lib/infra/proliferate-api";
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
  summarizeStartupError,
} from "#product/lib/infra/measurement/measurement-port";
import {
  createExpectedControlPlaneProbeTimeoutError,
} from "@proliferate/product-domain/telemetry/control-plane-probe-timeout";

let lastKnownControlPlaneReachable: boolean | null = null;
const CONTROL_PLANE_HEALTH_TIMEOUT_MS = 2_500;

export function getLastKnownControlPlaneReachable(): boolean | null {
  return lastKnownControlPlaneReachable;
}

export async function checkControlPlaneReachable(apiBaseUrl: string): Promise<boolean> {
  const startedAt = startStartupTimer();
  logStartupDebug("control_plane.health.start");
  const abortController = typeof AbortController !== "undefined"
    ? new AbortController()
    : null;
  const timeoutId = abortController
    ? globalThis.setTimeout(
      () => abortController.abort(createExpectedControlPlaneProbeTimeoutError()),
      CONTROL_PLANE_HEALTH_TIMEOUT_MS,
    )
    : null;

  try {
    const response = await fetch(buildProliferateApiUrl("/health", apiBaseUrl), {
      headers: {
        Accept: "application/json",
      },
      signal: abortController?.signal,
    });
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
      timedOut: abortController?.signal.aborted === true,
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
