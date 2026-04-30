import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ConnectorSettings } from "@/lib/domain/mcp/types";
import {
  classifyOAuthCommandTelemetryFailure,
  OAuthConnectorCommandError,
} from "@/lib/domain/mcp/oauth";
import {
  cancelOAuthConnectorConnect,
  connectOAuthConnector,
} from "@/lib/infra/mcp/persistence";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { refreshMcpConnectorsQuery } from "./use-connectors";

export function useConnectOAuthConnector() {
  const queryClient = useQueryClient();
  const pendingConnectionIdRef = useRef<string | null>(null);

  const mutation = useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (input: {
      catalogEntryId: string;
      settings?: ConnectorSettings;
    }) => {
      const connectionId = crypto.randomUUID();
      pendingConnectionIdRef.current = connectionId;
      return connectOAuthConnector(input.catalogEntryId, input.settings, connectionId);
    },
    onSuccess: async (result, variables) => {
      if (result.kind === "canceled") {
        return;
      }
      await refreshMcpConnectorsQuery(queryClient);
      trackProductEvent("connector_install_succeeded", {
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
      trackProductEvent("connector_install_failed", {
        connector_id: variables.catalogEntryId,
        failure_kind: classifyOAuthCommandTelemetryFailure(oauthError.kind),
      });
      captureTelemetryException(new Error(`mcp_oauth_${oauthError.kind}`), {
        tags: {
          action: "connect_cloud_oauth_connector",
          domain: "mcp_connectors",
        },
        extras: {
          catalogEntryId: variables.catalogEntryId,
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
