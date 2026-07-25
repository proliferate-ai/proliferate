import { useQuery } from "@tanstack/react-query";
import { listCurrentUserOrganizationInvitations } from "@proliferate/cloud-sdk/client/organizations";
import type { OrganizationInvitationsResponse } from "@/lib/access/cloud/client";
import { useAuthStore } from "@/stores/auth/auth-store";
import { currentUserOrganizationInvitationsKey } from "./query-keys";
import { isSignedInAuthStatus } from "@/lib/domain/auth/auth-state-mapping";

export function useCurrentUserOrganizationInvitations(enabled = true) {
  const authStatus = useAuthStore((state) => state.status);
  const authUserId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery<OrganizationInvitationsResponse>({
    queryKey: [...currentUserOrganizationInvitationsKey(), authUserId],
    enabled: enabled && isSignedInAuthStatus(authStatus) && authUserId !== null,
    queryFn: () => listCurrentUserOrganizationInvitations(),
  });
}
