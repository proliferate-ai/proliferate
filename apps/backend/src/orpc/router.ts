/**
 * Top-level oRPC router.
 *
 * Assembles all sub-routers and wraps them with the contract implementer
 * to ensure full contract enforcement.
 */

import { orpc } from "./contract";
import { authRouter } from "./routers/auth";
import { orgsRouter } from "./routers/orgs";
import { reposRouter } from "./routers/repos";
import { secretsRouter } from "./routers/secrets";
import { sessionsRouter } from "./routers/sessions";

export const appRouter = orpc.router({
	auth: authRouter,
	orgs: orgsRouter,
	repos: reposRouter,
	secrets: secretsRouter,
	sessions: sessionsRouter,
});
