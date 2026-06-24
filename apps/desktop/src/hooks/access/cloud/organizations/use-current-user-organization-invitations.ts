import { useQuery } from "@tanstack/react-query";
import { listCurrentUserOrganizationInvitations } from "@proliferate/cloud-sdk/client/organizations";
import type { OrganizationInvitationsResponse } from "@/lib/access/cloud/client";
import { currentUserOrganizationInvitationsKey } from "./query-keys";

export function useCurrentUserOrganizationInvitations(enabled = true) {
  return useQuery<OrganizationInvitationsResponse>({
    queryKey: currentUserOrganizationInvitationsKey(),
    enabled,
    queryFn: () => listCurrentUserOrganizationInvitations(),
  });
}
