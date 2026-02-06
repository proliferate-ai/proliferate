/**
 * oRPC App Router.
 *
 * Combines all feature routers into a single router.
 */

import { adminRouter } from "./admin";
import { automationsRouter } from "./automations";
import { billingRouter } from "./billing";
import { cliRouter } from "./cli";
import { integrationsRouter } from "./integrations";
import { intercomRouter } from "./intercom";
import { onboardingRouter } from "./onboarding";
import { orgsRouter } from "./orgs";
import { prebuildsRouter } from "./prebuilds";
import { reposRouter } from "./repos";
import { schedulesRouter } from "./schedules";
import { secretsRouter } from "./secrets";
import { sessionsRouter } from "./sessions";
import { triggersRouter } from "./triggers";

export const appRouter = {
	admin: adminRouter,
	automations: automationsRouter,
	billing: billingRouter,
	cli: cliRouter,
	integrations: integrationsRouter,
	intercom: intercomRouter,
	onboarding: onboardingRouter,
	orgs: orgsRouter,
	prebuilds: prebuildsRouter,
	repos: reposRouter,
	schedules: schedulesRouter,
	secrets: secretsRouter,
	sessions: sessionsRouter,
	triggers: triggersRouter,
};

export type AppRouter = typeof appRouter;
