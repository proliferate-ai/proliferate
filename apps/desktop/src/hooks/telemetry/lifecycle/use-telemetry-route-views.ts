import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import type { DesktopTelemetryRoute } from "@/lib/domain/telemetry/events";
import { resolveDesktopTelemetryRoute } from "@/lib/domain/telemetry/routes";
import {
  setTelemetryTag,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";

// Owns route view telemetry tags and events. Does not own route classification rules.
export function useTelemetryRouteViews() {
  const location = useLocation();
  const previousRouteRef = useRef<DesktopTelemetryRoute | null>(null);

  useEffect(() => {
    const currentRoute = resolveDesktopTelemetryRoute(location.pathname);
    if (previousRouteRef.current === currentRoute) return;
    previousRouteRef.current = currentRoute;

    setTelemetryTag("route", currentRoute);
    trackProductEvent("screen_viewed", {
      route: currentRoute,
    });
  }, [location.pathname]);
}
