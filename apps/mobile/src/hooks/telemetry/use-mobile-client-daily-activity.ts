import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { recordMobileClientDailyActivity } from "../../lib/integrations/telemetry/client-daily-activity";

export function useMobileClientDailyActivity(input: {
  accessToken: string | null;
  actorStorageKey: string | null;
  routeOrScreen: string;
  viewingChat: boolean;
}) {
  const routeOrScreen = input.viewingChat ? "chat" : input.routeOrScreen;
  const [activityTick, setActivityTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActivityTick((tick) => tick + 1);
    }, 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setActivityTick((tick) => tick + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    void recordMobileClientDailyActivity({
      accessToken: input.accessToken,
      actorStorageKey: input.actorStorageKey,
      routeOrScreen,
    }).catch((error) => {
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.warn("Failed to record mobile daily activity", error);
      }
    });
  }, [activityTick, input.accessToken, input.actorStorageKey, routeOrScreen]);
}
