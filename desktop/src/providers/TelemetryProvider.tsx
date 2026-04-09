import { type ReactNode } from "react";
import { useTelemetryBootstrap } from "@/hooks/telemetry/use-telemetry-bootstrap";

export function TelemetryProvider({ children }: { children: ReactNode }) {
  useTelemetryBootstrap();
  return <>{children}</>;
}
