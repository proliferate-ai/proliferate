/**
 * oRPC App Router.
 *
 * Combines all feature routers into a single router.
 */

import { actionsRouter } from "./actions";
import { adminRouter } from "./admin";
import { authRouter } from "./auth";
import { automationsRouter } from "./automations";
import { baselinesRouter } from "./baselines";
import { billingRouter } from "./billing";
import { configurationsRouter } from "./configurations";
import { integrationsRouter } from "./integrations";
import { intercomRouter } from "./intercom";
import { notificationsRouter } from "./notifications";
import { onboardingRouter } from "./onboarding";
import { orgsRouter } from "./orgs";
import { reposRouter } from "./repos";
import { schedulesRouter } from "./schedules";
import { secretFilesRouter } from "./secret-files";
import { secretsRouter } from "./secrets";
import { sessionsRouter } from "./sessions";
import { templatesRouter } from "./templates";
import { triggersRouter } from "./triggers";
import { userActionPreferencesRouter } from "./user-action-preferences";

export const appRouter = {
	actions: actionsRouter,
	admin: adminRouter,
	auth: authRouter,
	automations: automationsRouter,
	baselines: baselinesRouter,
	billing: billingRouter,
	integrations: integrationsRouter,
	intercom: intercomRouter,
	notifications: notificationsRouter,
	onboarding: onboardingRouter,
	orgs: orgsRouter,
	configurations: configurationsRouter,
	repos: reposRouter,
	schedules: schedulesRouter,
	secretFiles: secretFilesRouter,
	secrets: secretsRouter,
	sessions: sessionsRouter,
	templates: templatesRouter,
	triggers: triggersRouter,
	userActionPreferences: userActionPreferencesRouter,
};

export type AppRouter = typeof appRouter;
