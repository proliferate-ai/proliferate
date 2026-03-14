/**
 * Sessions router implementation (read-only).
 */

import { ORPCError } from "@orpc/server";
import { sessions } from "@proliferate/services";
import { orpc } from "../contract";
import { orgMiddleware } from "../middleware";

export const sessionsRouter = {
	list: orpc.sessions.list.use(orgMiddleware).handler(async ({ context }) => {
		const sessionsList = await sessions.listSessions(context.orgId);
		return { sessions: sessionsList };
	}),

	get: orpc.sessions.get.use(orgMiddleware).handler(async ({ input, context }) => {
		const session = await sessions.getSession(input.id, context.orgId);
		if (!session) throw new ORPCError("NOT_FOUND", { message: "Session not found" });
		return session;
	}),
};
