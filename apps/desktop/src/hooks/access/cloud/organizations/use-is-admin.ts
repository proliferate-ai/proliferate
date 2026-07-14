import { useMemo } from "react";
import { useOrganizationMembers } from "@/hooks/access/cloud/organizations/use-organization-members";
import { isSettingsAdminRole, isSettingsOwnerRole } from "@/lib/domain/settings/admin-roles";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

export function useIsAdmin(organizationId: string | null) {
  const authState = useProductHost().auth.state;
  const currentUserId = authState.status === "authenticated"
    ? authState.user?.id ?? null
    : null;
  const membersQuery = useOrganizationMembers(organizationId);
  const currentMember = useMemo(
    () => membersQuery.data?.members.find((member) => member.userId === currentUserId) ?? null,
    [currentUserId, membersQuery.data?.members],
  );
  const role = currentMember?.role ?? null;
  const isOwner = isSettingsOwnerRole(role);
  const isAdmin = isSettingsAdminRole(role);

  return {
    isAdmin,
    isOwner,
    role,
    currentMember,
    isLoading: membersQuery.isLoading,
    isError: membersQuery.isError,
    error: membersQuery.error,
    refetch: membersQuery.refetch,
  };
}
