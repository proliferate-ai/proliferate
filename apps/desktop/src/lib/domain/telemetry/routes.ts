import type { DesktopTelemetryRoute } from "@/lib/domain/telemetry/events";

export function resolveDesktopTelemetryRoute(pathname: string): DesktopTelemetryRoute {
  if (pathname === "/") return "main";
  if (pathname === "/login") return "login";
  if (pathname === "/settings") return "settings";
  if (pathname === "/integrations" || pathname === "/plugins") {
    return "integrations";
  }
  if (
    pathname === "/workflows"
    || pathname.startsWith("/workflows/")
    || pathname === "/automations"
    || pathname.startsWith("/automations/")
  ) {
    return "workflows";
  }
  return "unknown";
}
