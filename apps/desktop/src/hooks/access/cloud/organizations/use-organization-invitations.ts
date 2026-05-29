import { useQuery } from "@tanstack/react-query";
import { listOrganizationInvitations } from "@proliferate/cloud-sdk/client/organizations";
import { organizationInvitationsKey } from "./query-keys";

export function useOrganizationInvitations(organizationId: string | null) {
  return useQuery({
    queryKey: organizationInvitationsKey(organizationId),
    enabled: Boolean(organizationId),
    queryFn: () => listOrganizationInvitations(organizationId!),
  });
}
