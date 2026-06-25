import { webEnv } from "../../../config/env";

const STORAGE_PREFIX = "proliferate:client-daily-activity:web";
const inFlightActivityKeys = new Set<string>();

function analyticsEndpoint(): string {
  return `${webEnv.apiBaseUrl.replace(/\/$/u, "")}/v1/analytics/client-daily-activity`;
}

export function webTelemetryScreenForPath(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname === "/auth") return "auth";
  if (pathname === "/auth/callback") return "auth_callback";
  if (pathname === "/auth/desktop/handoff") return "desktop_handoff";
  if (pathname === "/auth/error") return "auth_error";
  if (pathname === "/connect-github") return "connect_github";
  if (/^\/join\/[^/]+$/u.test(pathname)) return "organization_join";
  if (pathname === "/integrations") return "integrations";
  if (pathname === "/workflows") return "workflows";
  if (pathname === "/automations") return "workflows";
  if (pathname === "/plugins") return "integrations";
  if (pathname === "/support") return "support";
  if (pathname === "/settings") return "settings";
  if (/^\/workspaces\/[^/]+\/chats\/[^/]+$/u.test(pathname)) return "chat";
  return "unknown";
}

export async function recordWebClientDailyActivity(input: {
  accessToken: string | null;
  actorStorageKey: string | null;
  routeOrScreen: string;
}): Promise<void> {
  if (!input.accessToken) {
    return;
  }
  const dateKey = new Date().toISOString().slice(0, 10);
  const storageKey = `${STORAGE_PREFIX}:${dateKey}:${input.actorStorageKey ?? "unknown_actor"}`;
  try {
    if (window.localStorage.getItem(storageKey) === "sent") {
      return;
    }
  } catch {
    // Local throttling is best-effort; the server still dedupes the event.
  }
  if (inFlightActivityKeys.has(storageKey)) {
    return;
  }
  inFlightActivityKeys.add(storageKey);

  try {
    const response = await fetch(analyticsEndpoint(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        surface: "web",
        routeOrScreen: input.routeOrScreen,
        platform: "web",
      }),
    });
    if (!response.ok) {
      throw new Error(`web_client_daily_activity_${response.status}`);
    }

    try {
      window.localStorage.setItem(storageKey, "sent");
    } catch {
      // Local throttling is best-effort; the server still dedupes the event.
    }
  } finally {
    inFlightActivityKeys.delete(storageKey);
  }
}
