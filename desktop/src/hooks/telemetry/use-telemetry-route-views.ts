import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import type { DesktopTelemetryRoute } from "@/lib/domain/telemetry/events";
import {
  setTelemetryTag,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";

function routeName(pathname: string): DesktopTelemetryRoute {
  if (pathname === "/") return "main";
  if (pathname === "/login") return "login";
  if (pathname === "/setup") return "setup";
  if (pathname === "/settings") return "settings";
  if (pathname === "/automations" || pathname.startsWith("/automations/")) {
    return "automations";
  }
  return "unknown";
}

export function useTelemetryRouteViews() {
  const location = useLocation();
  const previousRouteRef = useRef<DesktopTelemetryRoute | null>(null);

  useEffect(() => {
    const currentRoute = routeName(location.pathname);
    if (previousRouteRef.current === currentRoute) return;
    previousRouteRef.current = currentRoute;

    setTelemetryTag("route", currentRoute);
    trackProductEvent("screen_viewed", {
      route: currentRoute,
    });
  }, [location.pathname]);
}
