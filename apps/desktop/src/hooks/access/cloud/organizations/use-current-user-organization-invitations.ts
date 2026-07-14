import { useQuery } from "@tanstack/react-query";
import { listCurrentUserOrganizationInvitations } from "@proliferate/cloud-sdk/client/organizations";
import type { OrganizationInvitationsResponse } from "@/lib/access/cloud/client";
import {
  useProductAuthStatus,
  useProductAuthUserId,
} from "@/hooks/auth/facade/use-product-auth";
import { currentUserOrganizationInvitationsKey } from "./query-keys";

export function useCurrentUserOrganizationInvitations(enabled = true) {
  const authStatus = useProductAuthStatus();
  const authUserId = useProductAuthUserId();
  return useQuery<OrganizationInvitationsResponse>({
    queryKey: [...currentUserOrganizationInvitationsKey(), authUserId],
    enabled: enabled && authStatus === "authenticated" && authUserId !== null,
    queryFn: () => listCurrentUserOrganizationInvitations(),
  });
}
