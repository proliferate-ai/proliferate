/**
 * oRPC App Router.
 *
 * Combines all feature routers into a single router.
 */

import { actionsRouter } from "./actions";
import { adminRouter } from "./admin";
import { authRouter } from "./auth";
import { automationsRouter } from "./automations";
import { billingRouter } from "./billing";
import { configurationsRouter } from "./configurations";
import { integrationsRouter } from "./integrations";
import { intercomRouter } from "./intercom";
import { onboardingRouter } from "./onboarding";
import { orgsRouter } from "./orgs";
import { reposRouter } from "./repos";
import { schedulesRouter } from "./schedules";
import { secretFilesRouter, secretsRouter } from "./secrets";
import { sessionsRouter } from "./sessions";
import { triggersRouter } from "./triggers";

export const appRouter = {
	actions: actionsRouter,
	admin: adminRouter,
	auth: authRouter,
	automations: automationsRouter,
	billing: billingRouter,
	integrations: integrationsRouter,
	intercom: intercomRouter,
	onboarding: onboardingRouter,
	orgs: orgsRouter,
	configurations: configurationsRouter,
	repos: reposRouter,
	schedules: schedulesRouter,
	secretFiles: secretFilesRouter,
	secrets: secretsRouter,
	sessions: sessionsRouter,
	triggers: triggersRouter,
};

export type AppRouter = typeof appRouter;
