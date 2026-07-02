import { useMutation } from "@tanstack/react-query";
import {
  authenticateIntegration,
  cancelIntegrationOauthFlow,
  removeIntegrationAccount,
  type AuthenticateIntegrationRequest,
} from "@proliferate/cloud-sdk/client/integrations";
import { useInvalidateCloudIntegrations } from "./use-integration-health";

export function useIntegrationActions() {
  const invalidateCloudIntegrations = useInvalidateCloudIntegrations();

  const authenticateMutation = useMutation({
    mutationFn: (input: AuthenticateIntegrationRequest) => authenticateIntegration(input),
    onSuccess: () => invalidateCloudIntegrations(),
  });

  const disconnectMutation = useMutation({
    mutationFn: (accountId: string) => removeIntegrationAccount(accountId),
    onSuccess: () => invalidateCloudIntegrations(),
  });

  const cancelOauthFlowMutation = useMutation({
    mutationFn: (flowId: string) => cancelIntegrationOauthFlow(flowId),
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
