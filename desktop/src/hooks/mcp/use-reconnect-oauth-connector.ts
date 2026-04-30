import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ConnectorSettings } from "@/lib/domain/mcp/types";
import {
  classifyOAuthCommandTelemetryFailure,
  OAuthConnectorCommandError,
} from "@/lib/domain/mcp/oauth";
import { cancelOAuthConnectorConnect } from "@/lib/infra/mcp/persistence";
import { reconnectOAuthConnector } from "@/lib/infra/mcp/persistence";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { refreshMcpConnectorsQuery } from "./use-connectors";

export function useReconnectOAuthConnector() {
  const queryClient = useQueryClient();
  const pendingConnectionIdRef = useRef<string | null>(null);

  const mutation = useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (input: {
      connectionId: string;
      catalogEntryId: string;
      settings?: ConnectorSettings;
    }) => {
      pendingConnectionIdRef.current = input.connectionId;
      return reconnectOAuthConnector(input.connectionId, input.settings);
    },
    onSuccess: async (result, variables) => {
      if (result.kind === "canceled") {
        return;
      }
      await refreshMcpConnectorsQuery(queryClient);
      trackProductEvent("connector_updated", {
        connector_id: variables.catalogEntryId,
        result: "synced",
      });
    },
    onError: (error, variables) => {
      const oauthError = error instanceof OAuthConnectorCommandError
        ? error
        : new OAuthConnectorCommandError(
          "unexpected",
          "Couldn't complete OAuth for this connector.",
          false,
        );
      captureTelemetryException(new Error(`mcp_oauth_${oauthError.kind}`), {
        tags: {
          action: "reconnect_cloud_oauth_connector",
          domain: "mcp_connectors",
        },
        extras: {
          catalogEntryId: variables.catalogEntryId,
          failureKind: classifyOAuthCommandTelemetryFailure(oauthError.kind),
          retryable: oauthError.retryable,
          oauthFailureKind: oauthError.kind,
        },
      });
    },
    onSettled: () => {
      pendingConnectionIdRef.current = null;
    },
  });

  return {
    ...mutation,
    cancelPendingConnection: async () => {
      const connectionId = pendingConnectionIdRef.current;
      if (!connectionId) {
        return;
      }
      await cancelOAuthConnectorConnect(connectionId);
    },
  };
}
