import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ConnectorSettings } from "@/lib/domain/mcp/types";
import { classifyTelemetryFailure } from "@/lib/domain/telemetry/failures";
import { cancelLocalOAuthConnectorConnect, installConnector } from "@/lib/workflows/mcp/connector-persistence";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { refreshMcpConnectorsQuery } from "./use-connectors";

export function useInstallConnector() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (input: {
      catalogEntryId: string;
      secretFields: Record<string, string>;
      settings?: ConnectorSettings;
    }) => {
      return installConnector(input.catalogEntryId, input.secretFields, input.settings);
    },
    onSuccess: async (_result, variables) => {
      await refreshMcpConnectorsQuery(queryClient);
      trackProductEvent("connector_install_succeeded", {
        connector_id: variables.catalogEntryId,
        result: "synced",
      });
    },
    onError: (error, variables) => {
      trackProductEvent("connector_install_failed", {
        connector_id: variables.catalogEntryId,
        failure_kind: classifyTelemetryFailure(error),
      });
      captureTelemetryException(error, {
        tags: {
          action: "install_connector",
          domain: "mcp_connectors",
        },
        extras: {
          catalogEntryId: variables.catalogEntryId,
        },
      });
    },
  });

  return {
    ...mutation,
    cancelPendingLocalOAuth: cancelLocalOAuthConnectorConnect,
  };
}

export function trackConnectorConnectClicked(catalogEntryId: string) {
  trackProductEvent("connector_connect_clicked", {
    connector_id: catalogEntryId,
    auth_style: "cloud",
    availability: "cloud",
  });
}
