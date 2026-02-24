/**
 * Onboarding oRPC router.
 *
 * Thin wrapper that delegates to onboarding service.
 */

import { isBillingEnabled } from "@/lib/billing";
import { type GitHubIntegration, listGitHubRepos } from "@/lib/github";
import { logger } from "@/lib/logger";

const log = logger.child({ handler: "onboarding" });
import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { onboarding, orgs } from "@proliferate/services";
import {
	FinalizeOnboardingInputSchema,
	FinalizeOnboardingResponseSchema,
	OnboardingStatusSchema,
	SaveQuestionnaireInputSchema,
	SaveToolSelectionsInputSchema,
} from "@proliferate/shared";
import { TRIAL_CREDITS } from "@proliferate/shared/billing";
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
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ context }) => {
			try {
				await orgs.markOnboardingComplete(context.orgId, true);

				const org = await orgs.getBillingInfoV2(context.orgId);
				if (org?.billingState === "unconfigured") {
					await orgs.initializeBillingState(context.orgId, "trial", TRIAL_CREDITS);
				}
			} catch (err) {
				log.error({ err, orgId: context.orgId }, "Failed to mark complete");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to complete onboarding",
				});
			}

			// Also mark all other orgs the user belongs to as onboarding-complete.
			// This prevents the user from getting stuck in onboarding if their
			// session switches back to a personal workspace or another org.
			try {
				await orgs.markAllUserOrgsOnboardingComplete(context.user.id);
			} catch (err) {
				// Non-critical — log and continue
				log.warn({ err, userId: context.user.id }, "Failed to mark other orgs complete");
			}

			return { success: true };
		}),

	/**
	 * Get onboarding status for the current user/organization.
	 */
	getStatus: protectedProcedure.output(OnboardingStatusSchema).handler(async ({ context }) => {
		const orgId = context.session.activeOrganizationId;

		if (!orgId) {
			log.warn({ userId: context.user.id }, "No active organization for onboarding status check");
		}

		const status = await onboarding.getOnboardingStatus(orgId);

		if (orgId && !status.onboardingComplete) {
			const autoCompleted = await onboarding.autoCompleteIfNeeded(orgId, context.user.id);
			if (autoCompleted) {
				status.onboardingComplete = true;
			}
		}

		return status;
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
			const gitHubIntegration: GitHubIntegration = {
				id: integration.id,
				githubInstallationId: integration.github_installation_id,
				connectionId: integration.connection_id,
				provider: integration.provider ?? undefined,
			};

			let allRepos: Array<{
				id: number;
				full_name: string;
				private: boolean;
				clone_url: string;
				html_url: string;
				default_branch: string;
			}>;

			try {
				const result = await listGitHubRepos(gitHubIntegration);
				allRepos = result.repositories;
			} catch (err) {
				log.error({ err }, "Failed to fetch GitHub repos");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to fetch GitHub repositories",
				});
			}

			// Filter to only selected repos
			const selectedRepos = allRepos.filter((repo) => selectedGithubRepoIds.includes(repo.id));

			if (selectedRepos.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "None of the selected repos are accessible",
				});
			}

			// Delegate repo upsert + config creation to service
			try {
				return await onboarding.finalizeOnboarding({
					orgId,
					userId,
					selectedRepos,
					integrationId,
					gatewayUrl: env.NEXT_PUBLIC_GATEWAY_URL,
					serviceToken: env.SERVICE_TO_SERVICE_AUTH_TOKEN,
				});
			} catch (err) {
				log.error({ err }, "Failed to finalize onboarding");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: err instanceof Error ? err.message : "Failed to finalize onboarding",
				});
			}
		}),
};
