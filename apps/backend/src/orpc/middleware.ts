import {
	type Meta,
	ORPCError,
	type ORPCErrorConstructorMap,
	decorateMiddleware,
} from "@orpc/server";
import { type Auth, createAuth } from "@proliferate/auth-core";
import * as orgs from "@proliferate/services/orgs";
import { getSessionFromHeaders } from "../auth/session";

let authInstance: Auth | null = null;

function getAuth(): Auth {
	if (!authInstance) {
		authInstance = createAuth();
	}
	return authInstance;
}

type BaseContext = { request: Request };
type SessionContext = NonNullable<Awaited<ReturnType<typeof getSessionFromHeaders>>>;
type AuthContext = Pick<SessionContext, "user" | "session">;
type OrgContext = AuthContext & { orgId: string };

export const protectedMiddleware = decorateMiddleware<
	BaseContext,
	AuthContext,
	any,
	any,
	ORPCErrorConstructorMap<any>,
	Meta
>(async ({ context, next }) => {
	const session = await getSessionFromHeaders(getAuth(), context.request.headers);
	if (!session) {
		throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized" });
	}

	return next({
		context: {
			user: session.user,
			session: session.session,
		},
	});
});

export const orgMiddleware = decorateMiddleware<
	BaseContext,
	OrgContext,
	any,
	any,
	ORPCErrorConstructorMap<any>,
	Meta
>(async ({ context, next }) => {
	const session = await getSessionFromHeaders(getAuth(), context.request.headers);
	if (!session) {
		throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized" });
	}

	const orgId = session.session.activeOrganizationId;
	if (!orgId) {
		throw new ORPCError("BAD_REQUEST", { message: "No active organization" });
	}

	const isMember = await orgs.isMember(session.user.id, orgId);
	if (!isMember) {
		throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
	}

	return next({
		context: {
			user: session.user,
			session: session.session,
			orgId,
		},
	});
});
