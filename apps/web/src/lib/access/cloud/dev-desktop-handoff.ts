import { webEnv } from "../../../config/env";

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export function canUseDevDesktopHandoff(): boolean {
  return import.meta.env.DEV && LOCALHOST_NAMES.has(window.location.hostname);
}

export interface DevDesktopHandoffRecord {
  id: string;
  url: string;
  createdAt: string;
  openedAt?: string | null;
}

export async function queueDevDesktopHandoff(
  url: string,
): Promise<DevDesktopHandoffRecord | null> {
  if (!canUseDevDesktopHandoff()) {
    return null;
  }

  const endpoint = new URL("/v1/dev/desktop-handoff", webEnv.apiBaseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Could not queue the local Desktop handoff.");
  }
  return await response.json() as DevDesktopHandoffRecord;
}

export async function getDevDesktopHandoff(
  id: string,
  signal?: AbortSignal,
): Promise<DevDesktopHandoffRecord | null> {
  const endpoint = new URL(`/v1/dev/desktop-handoff/${id}`, webEnv.apiBaseUrl);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Cache-Control": "no-store",
    },
    signal,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Could not read the local Desktop handoff.");
  }
  return await response.json() as DevDesktopHandoffRecord;
}
