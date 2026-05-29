import type { DesktopTelemetryRoute } from "@/lib/domain/telemetry/events";

export function resolveDesktopTelemetryRoute(pathname: string): DesktopTelemetryRoute {
  if (pathname === "/") return "main";
  if (pathname === "/login") return "login";
  if (pathname === "/settings") return "settings";
  if (pathname === "/automations" || pathname.startsWith("/automations/")) {
    return "automations";
  }
  return "unknown";
}
