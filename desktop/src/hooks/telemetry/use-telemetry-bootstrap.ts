import { useTelemetryAuthIdentity } from "./use-telemetry-auth-identity";
import { useTelemetryAgentSeed } from "./use-telemetry-agent-seed";
import { useTelemetryRouteViews } from "./use-telemetry-route-views";
import { useTelemetryRuntimeState } from "./use-telemetry-runtime-state";
import { useTelemetryWorkspaceSelection } from "./use-telemetry-workspace-selection";

export function useTelemetryBootstrap() {
  useTelemetryAuthIdentity();
  useTelemetryAgentSeed();
  useTelemetryRouteViews();
  useTelemetryRuntimeState();
  useTelemetryWorkspaceSelection();
}
