import { useTelemetryAuthIdentity } from "./use-telemetry-auth-identity";
import { useTelemetryAgentSeed } from "./use-telemetry-agent-seed";
import { useTelemetryOrganizationIdentity } from "./use-telemetry-organization-identity";
import { useTelemetryRouteViews } from "./use-telemetry-route-views";
import { useTelemetryRuntimeState } from "./use-telemetry-runtime-state";
import { useTelemetryWorkspaceSelection } from "./use-telemetry-workspace-selection";

// Owns mounting app-wide telemetry lifecycle hooks. Does not own telemetry transport.
export function useTelemetryBootstrap() {
  useTelemetryAuthIdentity();
  useTelemetryAgentSeed();
  useTelemetryOrganizationIdentity();
  useTelemetryRouteViews();
  useTelemetryRuntimeState();
  useTelemetryWorkspaceSelection();
}
