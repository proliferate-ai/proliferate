import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCloudOrganizationIntegrationPolicy,
  patchCloudOrganizationIntegrationPolicy,
  type CloudOrganizationIntegrationPolicyResponse,
  type PatchCloudOrganizationIntegrationPolicyRequest,
} from "@proliferate/cloud-sdk";

import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  cloudOrganizationIntegrationPolicyKey,
  cloudPluginInventoryRootKey,
} from "../lib/query-keys.js";

export function useCloudOrganizationIntegrationPolicy(
  organizationId: string | null,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<CloudOrganizationIntegrationPolicyResponse>({
    queryKey: cloudOrganizationIntegrationPolicyKey(organizationId),
    queryFn: () => getCloudOrganizationIntegrationPolicy(organizationId!, client),
    enabled: enabled && organizationId !== null,
  });
}

export function useCloudOrganizationIntegrationPolicyActions(
  organizationId: string | null,
) {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: cloudOrganizationIntegrationPolicyKey(organizationId),
      }),
      queryClient.invalidateQueries({ queryKey: cloudPluginInventoryRootKey() }),
    ]);
  };
  const patchPolicy = useMutation<
    CloudOrganizationIntegrationPolicyResponse,
    Error,
    PatchCloudOrganizationIntegrationPolicyRequest
  >({
    mutationFn: (body) =>
      patchCloudOrganizationIntegrationPolicy(organizationId!, body, client),
    onSuccess: async (policy) => {
      queryClient.setQueryData(
        cloudOrganizationIntegrationPolicyKey(organizationId),
        policy,
      );
      await invalidate();
    },
  });

  return {
    patchPolicy: patchPolicy.mutateAsync,
    isPatchingPolicy: patchPolicy.isPending,
  };
}
