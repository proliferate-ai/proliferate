import { useMemo } from "react";
import { useOrganizationMembers } from "@/hooks/access/cloud/organizations/use-organization-members";
import { isSettingsAdminRole, isSettingsOwnerRole } from "@/lib/domain/settings/admin-roles";
import { useProductAuthUserId } from "@/hooks/auth/facade/use-product-auth";

export function useIsAdmin(organizationId: string | null) {
  const currentUserId = useProductAuthUserId();
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
