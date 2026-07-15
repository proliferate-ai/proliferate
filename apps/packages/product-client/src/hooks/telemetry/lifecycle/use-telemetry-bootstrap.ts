import { useTelemetryAuthIdentity } from "#product/hooks/telemetry/lifecycle/use-telemetry-auth-identity";
import { useTelemetryAgentSeed } from "#product/hooks/telemetry/lifecycle/use-telemetry-agent-seed";
import { useTelemetryOrganizationIdentity } from "#product/hooks/telemetry/lifecycle/use-telemetry-organization-identity";
import { useTelemetryRouteViews } from "#product/hooks/telemetry/lifecycle/use-telemetry-route-views";
import { useTelemetryRuntimeState } from "#product/hooks/telemetry/lifecycle/use-telemetry-runtime-state";
import { useTelemetryWorkspaceSelection } from "#product/hooks/telemetry/lifecycle/use-telemetry-workspace-selection";

// Owns mounting app-wide telemetry lifecycle hooks. Does not own telemetry transport.
export function useTelemetryBootstrap() {
  useTelemetryAuthIdentity();
  useTelemetryAgentSeed();
  useTelemetryOrganizationIdentity();
  useTelemetryRouteViews();
  useTelemetryRuntimeState();
  useTelemetryWorkspaceSelection();
}
