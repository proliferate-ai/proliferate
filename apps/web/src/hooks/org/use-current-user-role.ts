"use client";

import { useOrgMembers } from "@/hooks/org/use-orgs";
import { useActiveOrganization, useSession } from "@/lib/auth/client";

export function useCurrentUserRole() {
	const { data: activeOrg } = useActiveOrganization();
	const { data: authSession } = useSession();
	const currentUserId = authSession?.user?.id;

	const { data: members } = useOrgMembers(activeOrg?.id ?? "");

	const role = members?.find((m) => m.userId === currentUserId)?.role;

	return {
		role,
		isAdmin: role === "admin",
	};
}
