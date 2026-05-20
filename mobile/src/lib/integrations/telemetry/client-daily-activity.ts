import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { mobileEnv } from "../../../config/env";

const STORAGE_PREFIX = "proliferate:client-daily-activity:mobile";
const inFlightActivityKeys = new Set<string>();

function analyticsEndpoint(): string {
  return `${mobileEnv.apiBaseUrl.replace(/\/$/u, "")}/v1/analytics/client-daily-activity`;
}

export async function recordMobileClientDailyActivity(input: {
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
    if ((await SecureStore.getItemAsync(storageKey)) === "sent") {
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
        surface: "mobile",
        routeOrScreen: input.routeOrScreen,
        platform: Platform.OS,
      }),
    });
    if (!response.ok) {
      throw new Error(`mobile_client_daily_activity_${response.status}`);
    }

    try {
      await SecureStore.setItemAsync(storageKey, "sent");
    } catch {
      // Local throttling is best-effort; the server still dedupes the event.
    }
  } finally {
    inFlightActivityKeys.delete(storageKey);
  }
}
