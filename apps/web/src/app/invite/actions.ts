"use server";

import { getSession } from "@/lib/auth-helpers";
import { orgs } from "@proliferate/services";

export async function getBasicInviteInfo(id: string) {
	return orgs.getBasicInvitationInfo(id);
}

/**
 * Delete the current user's auto-created personal organization.
 * Called after accepting an invitation so the user only belongs to the invited org.
 */
export async function deletePersonalOrg() {
	const session = await getSession();
	if (!session?.user?.id) return false;
	return orgs.deletePersonalOrg(session.user.id);
}
