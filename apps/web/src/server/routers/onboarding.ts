/**
 * Onboarding oRPC router.
 *
 * Thin wrapper that delegates to onboarding service.
 */

import { isBillingEnabled } from "@/lib/infra/billing";
import { logger } from "@/lib/infra/logger";
import { listGitHubRepos } from "@/lib/integrations/github";

const log = logger.child({ handler: "onboarding" });
import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { onboarding } from "@proliferate/services";
import {
	FinalizeOnboardingInputSchema,
	FinalizeOnboardingResponseSchema,
	OnboardingStatusSchema,
	SaveQuestionnaireInputSchema,
	SaveToolSelectionsInputSchema,
} from "@proliferate/shared/contracts/onboarding";
import { z } from "zod";
import { orgProcedure, protectedProcedure } from "./middleware";

export const onboardingRouter = {
	/**
	 * Start a credit-based trial for a new organization.
	 * Stores the selected plan (dev/pro) and grants trial credits.
	 */
	startTrial: orgProcedure
		.input(
			z.object({
				plan: z.enum(["dev", "pro"]).optional(),
			}),
		)
		.output(
			z.object({
				success: z.boolean(),
				checkoutUrl: z.string().optional(),
				message: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				return await onboarding.startTrial({
					orgId: context.orgId,
					userId: context.user.id,
					userEmail: context.user.email,
					orgName: context.user.name || context.user.email,
					plan: input.plan,
					billingEnabled: isBillingEnabled(),
					appUrl: env.NEXT_PUBLIC_APP_URL,
				});
			} catch (err) {
				log.error({ err }, "Failed to start trial");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to start trial",
				});
			}
		}),

	/**
	 * Mark onboarding as complete for the organization.
	 * Called when the user finishes the onboarding flow.
	 * Also marks all other orgs the user belongs to (e.g. personal workspace)
	 * so they don't get stuck in onboarding if the active org changes.
	 */
	markComplete: orgProcedure
		.input(z.object({}).optional())
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ context }) => {
			try {
				await onboarding.completeOnboarding(context.orgId, context.user.id);
				return { success: true };
			} catch (err) {
				log.error({ err, orgId: context.orgId }, "Failed to mark complete");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to complete onboarding",
				});
			}
		}),

	/**
	 * Get onboarding status for the current user/organization.
	 */
	getStatus: protectedProcedure
		.input(z.object({}).optional())
		.output(OnboardingStatusSchema)
		.handler(async ({ context }) => {
			const orgId = context.session.activeOrganizationId;

			if (!orgId) {
				log.warn({ userId: context.user.id }, "No active organization for onboarding status check");
			}

			return onboarding.getOnboardingStatusWithAutoComplete(orgId, context.user.id);
		}),

	/**
	 * Save tool selections during onboarding.
	 */
	saveToolSelections: orgProcedure
		.input(SaveToolSelectionsInputSchema)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			await onboarding.saveToolSelections(context.orgId, input.selectedTools);
			return { success: true };
		}),

	/**
	 * Save questionnaire answers during onboarding.
	 */
	saveQuestionnaire: orgProcedure
		.input(SaveQuestionnaireInputSchema)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			await onboarding.saveQuestionnaire(context.orgId, {
				referralSource: input.referralSource,
				companyWebsite: input.companyWebsite,
				teamSize: input.teamSize,
			});
			return { success: true };
		}),

	/**
	 * Finalize onboarding by selecting repos and creating a managed configuration.
	 */
	finalize: orgProcedure
		.input(FinalizeOnboardingInputSchema)
		.output(FinalizeOnboardingResponseSchema)
		.handler(async ({ input, context }) => {
			const { selectedGithubRepoIds, integrationId } = input;
			const orgId = context.orgId;
			const userId = context.user.id;

			if (!selectedGithubRepoIds || selectedGithubRepoIds.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "At least one repo must be selected",
				});
			}

			if (!integrationId) {
				throw new ORPCError("BAD_REQUEST", {
					message: "integrationId is required",
				});
			}

			// Get integration for finalization
			const integration = await onboarding.getIntegrationForFinalization(integrationId, orgId);

			if (!integration) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Invalid or inactive integration",
				});
			}

			// Fetch available repos from GitHub (web-only: uses @octokit/auth-app)
			let allRepos: Awaited<ReturnType<typeof listGitHubRepos>>["repositories"];

			try {
				const result = await listGitHubRepos(integration);
				allRepos = result.repositories;
			} catch (err) {
				log.error({ err }, "Failed to fetch GitHub repos");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to fetch GitHub repositories",
				});
			}

			// Delegate repo filtering, upsert, and config creation to service
			try {
				return await onboarding.finalizeOnboardingWithRepos({
					orgId,
					userId,
					integrationId,
					selectedGithubRepoIds,
					allRepos,
					gatewayUrl: env.NEXT_PUBLIC_GATEWAY_URL,
					serviceToken: env.SERVICE_TO_SERVICE_AUTH_TOKEN,
				});
			} catch (err) {
				log.error({ err }, "Failed to finalize onboarding");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to finalize onboarding",
				});
			}
		}),
};
