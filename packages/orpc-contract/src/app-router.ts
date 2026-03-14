import { authContract } from "./routers/auth";
import { orgsContract } from "./routers/orgs";
import { reposContract } from "./routers/repos";
import { secretsContract } from "./routers/secrets";
import { sessionsContract } from "./routers/sessions";

export const appContract = {
	auth: authContract,
	orgs: orgsContract,
	repos: reposContract,
	secrets: secretsContract,
	sessions: sessionsContract,
};

export type AppRouter = typeof appContract;
