import { buildProliferateApiUrl } from "@/lib/infra/proliferate-api";

// Server-advertised feature posture, read from `GET /meta`
// (server/proliferate/server/meta.py). Today this carries the one D-003
// launch flag: `workflowsEnabled`. The server is the enforcement point (the
// workflows API 404s while dark); this read only decides which entry points
// the desktop draws, so the failure default is "dark" — a surface must never
// flash on a deployment that would 404 it.

export interface ServerFeatures {
  workflowsEnabled: boolean;
}

let lastKnownServerFeatures: ServerFeatures | null = null;
const SERVER_FEATURES_TIMEOUT_MS = 8_000;

export function getLastKnownServerFeatures(): ServerFeatures | null {
  return lastKnownServerFeatures;
}

export async function fetchServerFeatures(): Promise<ServerFeatures> {
  const abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = abortController
    ? globalThis.setTimeout(() => abortController.abort(), SERVER_FEATURES_TIMEOUT_MS)
    : null;
  try {
    const response = await fetch(buildProliferateApiUrl("/meta"), {
      headers: { Accept: "application/json" },
      signal: abortController?.signal,
    });
    if (!response.ok) {
      // An older server has no flag in /meta at all; treat a reachable server
      // without the field as workflows-on (pre-flag servers shipped the
      // surface unconditionally), but an unreachable/erroring one as unknown.
      return lastKnownServerFeatures ?? { workflowsEnabled: false };
    }
    const body: unknown = await response.json();
    const flag = (body as { workflowsEnabled?: unknown } | null)?.workflowsEnabled;
    const features: ServerFeatures = {
      workflowsEnabled: typeof flag === "boolean" ? flag : true,
    };
    lastKnownServerFeatures = features;
    return features;
  } catch {
    return lastKnownServerFeatures ?? { workflowsEnabled: false };
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}
