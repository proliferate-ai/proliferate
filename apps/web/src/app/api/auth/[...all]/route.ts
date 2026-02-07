import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { nodeEnv } from "@proliferate/environment/runtime";
import { env } from "@proliferate/environment/server";
import { orgs, users } from "@proliferate/services";
import { toNextJsHandler } from "better-auth/next-js";

const log = logger.child({ route: "auth" });

const { GET: originalGET, POST } = toNextJsHandler(auth);

// Wrap GET to handle DEV_USER_ID bypass for get-session
export async function GET(request: Request) {
	const devUserId = env.DEV_USER_ID;
	const url = new URL(request.url);
	const useDevBypass =
		!!devUserId && devUserId !== "disabled" && (nodeEnv !== "production" || env.CI);

	// Dev mode: skip auth and return session for the specified user
	if (useDevBypass && url.pathname === "/api/auth/get-session") {
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

	return originalGET(request);
}

export { POST };
