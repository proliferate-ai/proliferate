import { useQuery } from "@tanstack/react-query";
import type { OrganizationListResponse } from "@/lib/access/cloud/client";
import { listOrganizations } from "@proliferate/cloud-sdk/client/organizations";
import { useAuthStore } from "@/stores/auth/auth-store";
import { organizationsListKey } from "./query-keys";

export function useOrganizations() {
  const authStatus = useAuthStore((state) => state.status);
  const authUserId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery<OrganizationListResponse>({
    queryKey: [...organizationsListKey(), authUserId],
    enabled: authStatus === "authenticated" && authUserId !== null,
    queryFn: () => listOrganizations(),
  });
}
