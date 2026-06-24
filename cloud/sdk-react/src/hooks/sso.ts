import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOrganizationSsoConnection,
  deleteOrganizationSsoConnection,
  disableOrganizationSsoConnection,
  enableOrganizationSsoConnection,
  listOrganizationSsoConnections,
  testOrganizationSsoConnection,
  updateOrganizationSsoConnection,
  type OrganizationSsoConnectionRequest,
  type OrganizationSsoConnectionResponse,
  type OrganizationSsoConnectionTestResponse,
  type OrganizationSsoConnectionUpdateRequest,
  type OrganizationSsoConnectionsResponse,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import { organizationSsoConnectionsKey } from "../lib/query-keys.js";

export function useOrganizationSsoConnections(
  organizationId: string | null,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<OrganizationSsoConnectionsResponse>({
    queryKey: organizationSsoConnectionsKey(organizationId),
    queryFn: () => listOrganizationSsoConnections(organizationId!, client),
    enabled: enabled && organizationId !== null,
  });
}

export function useOrganizationSsoMutations(organizationId: string | null) {
  const queryClient = useQueryClient();
  const client = useCloudClient();
  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: organizationSsoConnectionsKey(organizationId),
    });
  };

  const create = useMutation<
    OrganizationSsoConnectionResponse,
    Error,
    OrganizationSsoConnectionRequest
  >({
    mutationFn: (input) => createOrganizationSsoConnection(organizationId!, input, client),
    onSuccess: invalidate,
  });
  const update = useMutation<
    OrganizationSsoConnectionResponse,
    Error,
    { connectionId: string; input: OrganizationSsoConnectionUpdateRequest }
  >({
    mutationFn: ({ connectionId, input }) =>
      updateOrganizationSsoConnection(organizationId!, connectionId, input, client),
    onSuccess: invalidate,
  });
  const test = useMutation<OrganizationSsoConnectionTestResponse, Error, string>({
    mutationFn: (connectionId) => testOrganizationSsoConnection(organizationId!, connectionId, client),
    onSuccess: invalidate,
  });
  const enable = useMutation<OrganizationSsoConnectionResponse, Error, string>({
    mutationFn: (connectionId) =>
      enableOrganizationSsoConnection(organizationId!, connectionId, client),
    onSuccess: invalidate,
  });
  const disable = useMutation<OrganizationSsoConnectionResponse, Error, string>({
    mutationFn: (connectionId) =>
      disableOrganizationSsoConnection(organizationId!, connectionId, client),
    onSuccess: invalidate,
  });
  const remove = useMutation<OrganizationSsoConnectionResponse, Error, string>({
    mutationFn: (connectionId) =>
      deleteOrganizationSsoConnection(organizationId!, connectionId, client),
    onSuccess: invalidate,
  });

  return {
    createConnection: create.mutateAsync,
    creatingConnection: create.isPending,
    updateConnection: update.mutateAsync,
    updatingConnection: update.isPending,
    testConnection: test.mutateAsync,
    testingConnection: test.isPending,
    enableConnection: enable.mutateAsync,
    enablingConnection: enable.isPending,
    disableConnection: disable.mutateAsync,
    disablingConnection: disable.isPending,
    deleteConnection: remove.mutateAsync,
    deletingConnection: remove.isPending,
  };
}
