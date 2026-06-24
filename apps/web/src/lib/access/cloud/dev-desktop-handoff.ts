import { webEnv } from "../../../config/env";

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export function canUseDevDesktopHandoff(): boolean {
  return import.meta.env.DEV && LOCALHOST_NAMES.has(window.location.hostname);
}

export async function queueDevDesktopHandoff(url: string): Promise<void> {
  if (!canUseDevDesktopHandoff()) {
    return;
  }

  const endpoint = new URL("/v1/dev/desktop-handoff", webEnv.apiBaseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error("Could not queue the local Desktop handoff.");
  }
}
