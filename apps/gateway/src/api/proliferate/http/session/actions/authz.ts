import { orgs, sessions } from "@proliferate/services";
import { ApiError } from "../../../../../middleware/errors";

export async function requireSessionOrgAccess(
	sessionId: string,
	userOrgId: string | undefined,
): Promise<{ organizationId: string }> {
	const session = await sessions.findByIdInternal(sessionId);
	if (!session) {
		throw new ApiError(404, "Session not found");
	}
	if (!userOrgId || userOrgId !== session.organizationId) {
		throw new ApiError(403, "You do not have access to this session");
	}
	return session;
}

export async function isOrgAdmin(userId: string, orgId: string): Promise<boolean> {
	const role = await orgs.getUserRole(userId, orgId);
	return role === "owner" || role === "admin";
}
