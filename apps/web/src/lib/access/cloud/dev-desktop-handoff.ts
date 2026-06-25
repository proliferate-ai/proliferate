import { webEnv } from "../../../config/env";

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export function canUseDevDesktopHandoff(): boolean {
  return import.meta.env.DEV && LOCALHOST_NAMES.has(window.location.hostname);
}

export async function queueDevDesktopHandoff(url: string): Promise<boolean> {
  if (!canUseDevDesktopHandoff()) {
    return false;
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
    return false;
  }
  if (!response.ok) {
    throw new Error("Could not queue the local Desktop handoff.");
  }
  return true;
}
