import type { Auth } from "@proliferate/auth-core";
import { createLogger } from "@proliferate/logger";
import { orgs, users } from "@proliferate/services";

const log = createLogger({ service: "backend" }).child({ module: "auth" });

export interface SessionResult {
	user: {
		id: string;
		email: string;
		name: string;
	};
	session: {
		id: string;
		activeOrganizationId?: string | null;
	};
}

export async function getSessionFromHeaders(
	auth: Auth,
	headers: Headers,
): Promise<SessionResult | null> {
	// Check for API key auth first
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

	// Cookie-based session
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

export async function requireAuthFromHeaders(auth: Auth, headers: Headers): Promise<SessionResult> {
	const session = await getSessionFromHeaders(auth, headers);
	if (!session) {
		throw new Error("Unauthorized");
	}
	return session;
}
