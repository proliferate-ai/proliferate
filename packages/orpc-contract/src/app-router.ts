import { authContract } from "./routers/auth";
import { orgsContract } from "./routers/orgs";

export const appContract = {
	auth: authContract,
	orgs: orgsContract,
};

export type AppRouter = typeof appContract;
