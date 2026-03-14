/**
 * oRPC middleware.
 *
 * Session resolution helpers used in router .use() chains.
 */

import { ORPCError } from "@orpc/server";
import { type Auth, createAuth } from "@proliferate/auth-core";
import { orgs } from "@proliferate/services";
import { type SessionResult, getSessionFromHeaders } from "../auth/session";

// ============================================
// Lazy auth instance
// ============================================

let authInstance: Auth | null = null;

function getAuth(): Auth {
	if (!authInstance) {
		authInstance = createAuth();
	}
	return authInstance;
}

// ============================================
// Session resolution helpers
// ============================================

export async function resolveSession(request: Request): Promise<SessionResult> {
	const session = await getSessionFromHeaders(getAuth(), request.headers);
	if (!session) {
		throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized" });
	}
	return session;
}

export async function resolveSessionWithOrg(
	request: Request,
): Promise<SessionResult & { orgId: string }> {
	const session = await resolveSession(request);

	const orgId = session.session.activeOrganizationId;
	if (!orgId) {
		throw new ORPCError("BAD_REQUEST", { message: "No active organization" });
	}

	const isMember = await orgs.isMember(session.user.id, orgId);
	if (!isMember) {
		throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
	}

	return { ...session, orgId };
}
