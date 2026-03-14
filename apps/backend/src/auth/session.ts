import type { Auth } from "@proliferate/auth-core";
import { createLogger } from "@proliferate/logger";
import * as orgs from "@proliferate/services/orgs";
import * as users from "@proliferate/services/users";

const log = createLogger({ service: "backend" }).child({ module: "auth" });

type SessionResult = {
	user: {
		id: string;
		email: string;
		name: string;
	};
	session: {
		id: string;
		activeOrganizationId?: string | null;
	};
};

function getDevUserId(): string | undefined {
	const devUserId = process.env.DEV_USER_ID;
	if (
		devUserId &&
		devUserId !== "disabled" &&
		process.env.NODE_ENV !== "production" &&
		!process.env.CI
	) {
		return devUserId;
	}
	return undefined;
}

export async function getSessionFromHeaders(
	auth: Auth,
	headers: Headers,
): Promise<SessionResult | null> {
	const devUserId = getDevUserId();
	if (devUserId) {
		const user = await users.findById(devUserId);
		if (user) {
			const orgId = await orgs.getFirstOrgIdForUser(devUserId);
			return {
				user: { id: user.id, email: user.email, name: user.name },
				session: { id: `dev-session-${devUserId}`, activeOrganizationId: orgId ?? null },
			};
		}
	}

	const authorization = headers.get("authorization");

	if (authorization?.startsWith("Bearer ")) {
		const key = authorization.replace("Bearer ", "");
		const orgIdHeader = headers.get("x-org-id");

		try {
			const result = await auth.api.verifyApiKey({ body: { key } });
			if (!result.valid || !result.key) return null;

			const user = await users.findById(result.key.userId);
			if (!user) return null;

			let orgId: string | null = null;
			if (orgIdHeader) {
				const role = await orgs.getUserRole(user.id, orgIdHeader);
				if (!role) {
					log.warn(
						{ userId: user.id, orgId: orgIdHeader },
						"API key org header is not authorized for user",
					);
					return null;
				}
				orgId = orgIdHeader;
			}
			if (!orgId) {
				orgId = await orgs.getFirstOrgIdForUser(user.id);
			}

			return {
				user: { id: user.id, email: user.email, name: user.name },
				session: { id: `apikey-${result.key.id}`, activeOrganizationId: orgId },
			};
		} catch (error) {
			log.error({ err: error }, "API key verification failed");
			return null;
		}
	}

	const session = await auth.api.getSession({ headers });
	if (!session?.user) return null;

	return {
		user: {
			id: session.user.id,
			email: session.user.email,
			name: session.user.name,
		},
		session: {
			id: session.session.id,
			activeOrganizationId: session.session.activeOrganizationId,
		},
	};
}
