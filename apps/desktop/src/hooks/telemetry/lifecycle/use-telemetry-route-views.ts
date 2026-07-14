import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import type { DesktopTelemetryRoute } from "@/lib/domain/telemetry/events";
import { resolveDesktopTelemetryRoute } from "@/lib/domain/telemetry/routes";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";

// Owns product route classification, screen-view deduplication, and the single
// `screen_viewed` product event. Classifies the current pathname here (product
// code), hands the classified route to the host for vendor navigation metadata,
// then emits exactly one screen-view event through the typed adapter.
export function useTelemetryRouteViews() {
  const location = useLocation();
  const telemetry = useProductTelemetry();
  const previousRouteRef = useRef<DesktopTelemetryRoute | null>(null);

  useEffect(() => {
    const currentRoute = resolveDesktopTelemetryRoute(location.pathname);
    if (previousRouteRef.current === currentRoute) return;
    previousRouteRef.current = currentRoute;

    telemetry.routeChanged({ pathname: location.pathname, routeId: currentRoute });
    telemetry.track("screen_viewed", {
      route: currentRoute,
    });
  }, [location.pathname, telemetry]);
}
