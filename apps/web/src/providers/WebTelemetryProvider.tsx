import { useAuthViewer } from "@proliferate/cloud-sdk-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import {
  recordWebClientDailyActivity,
  webTelemetryScreenForPath,
} from "../lib/integrations/telemetry/client-daily-activity";
import { getWebTelemetryConfig } from "../lib/integrations/telemetry/config";
import {
  identifyWebPostHogUser,
  initializeWebPostHog,
  resetWebPostHogUser,
  trackWebPostHogPageView,
  webTelemetryRouteForPathname,
} from "../lib/integrations/telemetry/posthog";
import {
  addWebSentryBreadcrumb,
  clearWebSentryUser,
  setWebSentryUser,
} from "../lib/integrations/telemetry/sentry";
import { useAuthToken } from "./WebCloudProvider";

export function WebTelemetryProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => getWebTelemetryConfig(), []);
  const { token, user, bootstrapping } = useAuthToken();
  const viewer = useAuthViewer(!bootstrapping && Boolean(token));
  const location = useLocation();
  const lastIdentityRef = useRef<string | null>(null);
  const lastPageRef = useRef<string | null>(null);
  const [activityTick, setActivityTick] = useState(0);

  useEffect(() => {
    initializeWebPostHog({
      environment: config.environment,
      release: config.release,
      posthog: config.posthog,
    });
  }, [config]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActivityTick((tick) => tick + 1);
    }, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const route = webTelemetryRouteForPathname(location.pathname);
    const pageKey = `${location.key}:${route}`;
    if (lastPageRef.current === pageKey) return;
    lastPageRef.current = pageKey;
    addWebSentryBreadcrumb("web_page_viewed", {
      route,
      surface: "web",
    });
    trackWebPostHogPageView(route);
  }, [location.key, location.pathname]);

  useEffect(() => {
    if (!token) {
      if (lastIdentityRef.current !== null) {
        clearWebSentryUser();
        resetWebPostHogUser();
        lastIdentityRef.current = null;
      }
      return;
    }

    const viewerUser = viewer.data?.user;
    if (!viewerUser || lastIdentityRef.current === viewerUser.id) {
      return;
    }

    setWebSentryUser(viewerUser.id);
    identifyWebPostHogUser(viewerUser);
    lastIdentityRef.current = viewerUser.id;
  }, [token, viewer.data?.user]);

  useEffect(() => {
    void recordWebClientDailyActivity({
      accessToken: token,
      actorStorageKey: viewer.data?.user?.id ?? user?.id ?? null,
      routeOrScreen: webTelemetryScreenForPath(location.pathname),
    }).catch((error) => {
      if (import.meta.env.DEV) {
        console.warn("Failed to record web daily activity", error);
      }
    });
  }, [activityTick, location.pathname, token, user?.id, viewer.data?.user?.id]);

  return children;
}
