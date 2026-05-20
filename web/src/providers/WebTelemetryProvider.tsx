import { useAuthViewer } from "@proliferate/cloud-sdk-react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";

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
  const { token, bootstrapping } = useAuthToken();
  const viewer = useAuthViewer(!bootstrapping && Boolean(token));
  const location = useLocation();
  const lastIdentityRef = useRef<string | null>(null);
  const lastPageRef = useRef<string | null>(null);

  useEffect(() => {
    initializeWebPostHog({
      environment: config.environment,
      release: config.release,
      posthog: config.posthog,
    });
  }, [config]);

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

    const user = viewer.data?.user;
    if (!user || lastIdentityRef.current === user.id) {
      return;
    }

    setWebSentryUser(user.id);
    identifyWebPostHogUser(user);
    lastIdentityRef.current = user.id;
  }, [token, viewer.data?.user]);

  return children;
}
