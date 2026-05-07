import { buildProliferateApiUrl } from "@/lib/infra/proliferate-api";
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
  summarizeStartupError,
} from "@/lib/infra/measurement/debug-startup";

let lastKnownControlPlaneReachable: boolean | null = null;

export function getLastKnownControlPlaneReachable(): boolean | null {
  return lastKnownControlPlaneReachable;
}

export async function checkControlPlaneReachable(): Promise<boolean> {
  const startedAt = startStartupTimer();
  logStartupDebug("control_plane.health.start");

  try {
    const response = await fetch(buildProliferateApiUrl("/health"), {
      headers: {
        Accept: "application/json",
      },
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
      ...summarizeStartupError(error),
    });
    return false;
  }
}
