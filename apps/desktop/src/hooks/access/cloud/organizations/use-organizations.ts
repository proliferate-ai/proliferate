import { useQuery } from "@tanstack/react-query";
import type { OrganizationListResponse } from "@/lib/access/cloud/client";
import { listOrganizations } from "@proliferate/cloud-sdk/client/organizations";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { organizationsListKey } from "./query-keys";

export function useOrganizations() {
  const host = useProductHost();
  const authState = host.auth.state;
  const cloudClient = host.cloud.client;
  const authStatus = authState.status;
  const authUserId = authState.status === "authenticated"
    ? authState.user?.id ?? null
    : null;
  return useQuery<OrganizationListResponse>({
    queryKey: [...organizationsListKey(), authUserId],
    enabled:
      authStatus === "authenticated"
      && authUserId !== null
      && cloudClient !== null,
    queryFn: () => listOrganizations(cloudClient!),
  });
}
