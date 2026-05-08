import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ConnectorSettings } from "@/lib/domain/mcp/types";
import {
  classifyOAuthCommandTelemetryFailure,
  OAuthConnectorCommandError,
} from "@/lib/domain/mcp/oauth";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import {
  cancelPendingOAuthConnectorConnection,
  useReconnectOAuthConnectorMutation,
} from "@/hooks/access/mcp/connectors/use-connector-mutations";

export function useReconnectOAuthConnector() {
  const reconnectOAuthConnectorMutation = useReconnectOAuthConnectorMutation();
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
      return reconnectOAuthConnectorMutation.mutateAsync(input);
    },
    onSuccess: (result, variables) => {
      if (result.kind === "canceled") {
        return;
      }
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
      await cancelPendingOAuthConnectorConnection(connectionId);
    },
  };
}
