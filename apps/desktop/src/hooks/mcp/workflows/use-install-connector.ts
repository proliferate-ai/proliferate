import { useMutation } from "@tanstack/react-query";
import { classifyTelemetryFailure } from "@/lib/domain/telemetry/failures";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import {
  cancelPendingLocalOAuthConnectorConnect,
  type InstallConnectorMutationInput,
  useInstallConnectorMutation,
} from "@/hooks/access/mcp/connectors/use-connector-mutations";

export function useInstallConnector() {
  const installConnectorMutation = useInstallConnectorMutation();

  const mutation = useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: (input: InstallConnectorMutationInput) =>
      installConnectorMutation.mutateAsync(input),
    onSuccess: (_result, variables) => {
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
    cancelPendingLocalOAuth: cancelPendingLocalOAuthConnectorConnect,
  };
}
