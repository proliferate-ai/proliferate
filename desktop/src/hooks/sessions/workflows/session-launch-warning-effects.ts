import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";

export function reportConnectorLaunchWarnings(
  warnings: ConnectorLaunchResolutionWarning[],
  showToast: (message: string, type?: "error" | "info") => void,
) {
  if (warnings.length === 0) {
    return;
  }

  for (const warning of warnings) {
    trackProductEvent("connector_skipped_at_launch", {
      connector_id: warning.catalogEntryId,
      reason_kind: warning.kind,
    });
  }

  if (warnings.length === 1) {
    const warning = warnings[0]!;
    if (warning.kind === "unsupported_target") {
      showToast(`${warning.connectorName} wasn't available in this session because it only supports local runtimes.`, "info");
      return;
    }
    if (warning.kind === "command_missing") {
      showToast(`${warning.connectorName} wasn't available in this session because its local command wasn't installed.`, "info");
      return;
    }
    if (warning.kind === "workspace_path_unresolved") {
      showToast(`${warning.connectorName} wasn't available in this session because the workspace path couldn't be resolved.`, "info");
      return;
    }
    if (warning.kind === "needs_reconnect") {
      showToast(`${warning.connectorName} wasn't available in this session because it needs reconnecting.`, "info");
      return;
    }
    showToast(`${warning.connectorName} wasn't available in this session because it needs a token.`, "info");
    return;
  }

  showToast(`${warnings.length} connectors weren't available in this session.`, "info");
}
