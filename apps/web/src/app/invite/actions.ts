"use server";

import { orgs } from "@proliferate/services";

export async function getBasicInviteInfo(id: string) {
	return orgs.getBasicInvitationInfo(id);
}
