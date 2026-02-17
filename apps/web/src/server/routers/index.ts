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
import { cliRouter } from "./cli";
import { integrationsRouter } from "./integrations";
import { intercomRouter } from "./intercom";
import { onboardingRouter } from "./onboarding";
import { orgsRouter } from "./orgs";
import { prebuildsRouter } from "./prebuilds";
import { reposRouter } from "./repos";
import { schedulesRouter } from "./schedules";
import { secretFilesRouter } from "./secret-files";
import { secretsRouter } from "./secrets";
import { sessionsRouter } from "./sessions";
import { triggersRouter } from "./triggers";
import { userActionPreferencesRouter } from "./user-action-preferences";

export const appRouter = {
	actions: actionsRouter,
	admin: adminRouter,
	auth: authRouter,
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
	secretFiles: secretFilesRouter,
	secrets: secretsRouter,
	sessions: sessionsRouter,
	triggers: triggersRouter,
	userActionPreferences: userActionPreferencesRouter,
};

export type AppRouter = typeof appRouter;
