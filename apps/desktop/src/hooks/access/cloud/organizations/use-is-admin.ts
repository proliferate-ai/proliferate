import { useMemo } from "react";
import { useOrganizationMembers } from "@/hooks/access/cloud/organizations/use-organization-members";
import { isSettingsAdminRole, isSettingsOwnerRole } from "@/lib/domain/settings/admin-roles";
import { useAuthStore } from "@/stores/auth/auth-store";

export function useIsAdmin(organizationId: string | null) {
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
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
