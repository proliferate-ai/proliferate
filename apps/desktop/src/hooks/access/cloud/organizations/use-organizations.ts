import { useQuery } from "@tanstack/react-query";
import type { OrganizationListResponse } from "@/lib/access/cloud/client";
import { listOrganizations } from "@proliferate/cloud-sdk/client/organizations";
import {
  useProductAuthStatus,
  useProductAuthUserId,
} from "@/hooks/auth/facade/use-product-auth";
import { organizationsListKey } from "./query-keys";

export function useOrganizations() {
  const authStatus = useProductAuthStatus();
  const authUserId = useProductAuthUserId();
  return useQuery<OrganizationListResponse>({
    queryKey: [...organizationsListKey(), authUserId],
    enabled: authStatus === "authenticated" && authUserId !== null,
    queryFn: () => listOrganizations(),
  });
}
