import { useMutation } from "@tanstack/react-query";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import {
  type SetConnectorPublicExposureMutationInput,
  useSetConnectorPublicExposureMutation,
} from "@/hooks/access/mcp/connectors/use-connector-mutations";

export function useSetConnectorPublicExposure() {
  const setPublicExposureMutation = useSetConnectorPublicExposureMutation();

  return useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: (input: SetConnectorPublicExposureMutationInput) =>
      setPublicExposureMutation.mutateAsync(input),
    onSuccess: (_result, variables) => {
      trackProductEvent("connector_updated", {
        connector_id: variables.record.catalogEntry.id,
        result: "synced",
      });
    },
    onError: (error, variables) => {
      captureTelemetryException(error, {
        tags: {
          action: "set_connector_public_exposure",
          domain: "mcp_connectors",
        },
        extras: {
          catalogEntryId: variables.record.catalogEntry.id,
          connectionId: variables.record.metadata.connectionId,
          publicToOrg: variables.publicToOrg,
          organizationId: variables.organizationId,
        },
      });
    },
  });
}
