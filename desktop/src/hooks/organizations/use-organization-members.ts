import { useQuery } from "@tanstack/react-query";
import { listOrganizationMembers } from "@/lib/access/cloud/organizations";
import { organizationMembersKey } from "./query-keys";

export type { OrganizationMemberResponse } from "@/lib/access/cloud/client";

export function useOrganizationMembers(organizationId: string | null) {
  return useQuery({
    queryKey: organizationMembersKey(organizationId),
    enabled: Boolean(organizationId),
    queryFn: () => listOrganizationMembers(organizationId!),
  });
}
