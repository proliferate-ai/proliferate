import { useMutation } from "@tanstack/react-query";
import {
  authenticateIntegration,
  cancelIntegrationOauthFlow,
  removeIntegrationAccount,
  type AuthenticateIntegrationRequest,
} from "@proliferate/cloud-sdk/client/integrations";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { requireHostCloudClient } from "@/lib/access/cloud/host-client";
import { useInvalidateCloudIntegrations } from "./use-integration-health";

export function useIntegrationActions() {
  const invalidateCloudIntegrations = useInvalidateCloudIntegrations();
  const cloudClient = useProductHost().cloud.client;

  const authenticateMutation = useMutation({
    mutationFn: (input: AuthenticateIntegrationRequest) =>
      authenticateIntegration(input, requireHostCloudClient(cloudClient)),
    onSuccess: () => invalidateCloudIntegrations(),
  });

  const disconnectMutation = useMutation({
    mutationFn: (accountId: string) =>
      removeIntegrationAccount(accountId, requireHostCloudClient(cloudClient)),
    onSuccess: () => invalidateCloudIntegrations(),
  });

  const cancelOauthFlowMutation = useMutation({
    mutationFn: (flowId: string) =>
      cancelIntegrationOauthFlow(flowId, requireHostCloudClient(cloudClient)),
    onSuccess: () => invalidateCloudIntegrations(),
  });

  return {
    authenticate: authenticateMutation.mutateAsync,
    authenticating: authenticateMutation.isPending,
    disconnect: disconnectMutation.mutateAsync,
    disconnecting: disconnectMutation.isPending,
    cancelOauthFlow: cancelOauthFlowMutation.mutateAsync,
    cancellingOauthFlow: cancelOauthFlowMutation.isPending,
  };
}
