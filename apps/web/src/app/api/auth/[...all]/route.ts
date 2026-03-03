import { auth } from "@/lib/auth/server";
import { getDevUserId } from "@/lib/auth/server/helpers";
import { logger } from "@/lib/logger";
import { orgs, users } from "@proliferate/services";
import { toNextJsHandler } from "better-auth/next-js";

const log = logger.child({ route: "auth" });

const { GET: originalGET, POST } = toNextJsHandler(auth);

// Wrap GET to handle DEV_USER_ID bypass for get-session and organization endpoints
export async function GET(request: Request) {
	const devUserId = getDevUserId();
	const url = new URL(request.url);

	if (devUserId) {
		// Dev mode: skip auth and return session for the specified user
		if (url.pathname === "/api/auth/get-session") {
			const user = await users.findById(devUserId);

			if (!user) {
				log.error({ devUserId }, "DEV_USER_ID user not found");
				return Response.json({ session: null, user: null });
			}

			const organizationId = await orgs.getFirstOrgIdForUser(devUserId);

			return Response.json({
				session: {
					id: `dev-session-${devUserId}`,
					userId: user.id,
					expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
					activeOrganizationId: organizationId ?? null,
				},
				user: {
					id: user.id,
					email: user.email,
					name: user.name,
					image: user.image,
					emailVerified: user.emailVerified,
					createdAt: user.createdAt,
					updatedAt: user.updatedAt,
				},
			});
		}

		// Dev mode: return the active organization for the dev user.
		// better-auth's org endpoints require a real session cookie which
		// doesn't exist in DEV_USER_ID mode, so we handle them here.
		if (url.pathname === "/api/auth/organization/get-full-organization") {
			const organizationId = await orgs.getFirstOrgIdForUser(devUserId);
			if (!organizationId) return Response.json(null);

			const org = await orgs.getOrg(organizationId, devUserId);
			if (!org) return Response.json(null);

			const members = await orgs.listMembers(organizationId, devUserId);

			return Response.json({
				...org,
				members: members ?? [],
				invitations: [],
			});
		}

		// Dev mode: list organizations for the dev user
		if (url.pathname === "/api/auth/organization/list") {
			const userOrgs = await orgs.listOrgs(devUserId);
			return Response.json(userOrgs ?? []);
		}
	}

	return originalGET(request);
}

export { POST };
