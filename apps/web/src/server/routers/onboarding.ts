/**
 * Onboarding oRPC router.
 *
 * Handles onboarding status and finalization.
 */

import { isBillingEnabled } from "@/lib/billing";
import { type GitHubIntegration, listGitHubRepos } from "@/lib/github";
import { logger } from "@/lib/logger";

const log = logger.child({ handler: "onboarding" });
import { NANGO_GITHUB_INTEGRATION_ID } from "@/lib/nango";
import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { createSyncClient } from "@proliferate/gateway-clients";
import { getOrCreateManagedPrebuild, onboarding, orgs } from "@proliferate/services";
import {
	FinalizeOnboardingInputSchema,
	FinalizeOnboardingResponseSchema,
	OnboardingStatusSchema,
} from "@proliferate/shared";
import { TRIAL_CREDITS, autumnAttach, autumnCreateCustomer } from "@proliferate/shared/billing";
import { z } from "zod";
import { orgProcedure, protectedProcedure } from "./middleware";

const GATEWAY_URL = env.NEXT_PUBLIC_GATEWAY_URL;
const SERVICE_TO_SERVICE_AUTH_TOKEN = env.SERVICE_TO_SERVICE_AUTH_TOKEN;

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
			const selectedPlan = input.plan || "dev";

			// If billing not configured, just mark onboarding complete
			if (!isBillingEnabled()) {
				try {
					await orgs.markOnboardingComplete(context.orgId, true);
					await orgs.updateBillingPlan(context.orgId, selectedPlan);
				} catch (err) {
					log.error({ err }, "Failed to mark onboarding as complete");
				}

				return {
					success: true,
					message: "Billing not configured - trial started without payment",
				};
			}

			// Check if org already has a customer ID
			const org = await orgs.getBillingInfoV2(context.orgId);

			if (!org) {
				log.error({ orgId: context.orgId }, "Failed to fetch organization row");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to check organization billing state",
				});
			}

			try {
				await orgs.updateBillingPlan(context.orgId, selectedPlan);

				const baseUrl = env.NEXT_PUBLIC_APP_URL;
				let customerId = org.autumnCustomerId ?? context.orgId;
				try {
					const customer = await autumnCreateCustomer({
						id: customerId,
						name: org.name,
						email: context.user.email,
					});
					customerId = customer.customer?.id ?? customer.data?.id ?? customer.id ?? customerId;
					if (customerId !== org.autumnCustomerId) {
						await orgs.updateAutumnCustomerId(context.orgId, customerId);
					}
				} catch (err) {
					log.warn({ err }, "Failed to create Autumn customer");
				}

				let setup: Awaited<ReturnType<typeof autumnAttach>> | null = null;
				try {
					setup = await autumnAttach({
						customer_id: customerId,
						product_id: selectedPlan,
						success_url: `${baseUrl}/onboarding/complete`,
						cancel_url: `${baseUrl}/onboarding`,
						customer_data: {
							email: context.user.email,
							name: org.name,
						},
						// Collect a payment method as part of onboarding, even if one
						// already exists (e.g. retries). Autumn will no-op if it can.
						force_checkout: true,
					});
				} catch (attachErr) {
					const msg = attachErr instanceof Error ? attachErr.message : "";
					if (msg.includes("already scheduled") || msg.includes("can't attach again")) {
						// Product already attached from a previous attempt — treat as success.
						log.info("Product already attached, skipping autumnAttach");
					} else if (msg.includes("force_checkout")) {
						// Autumn rejects force_checkout on upgrade/downgrade (e.g. onboarding
						// retry when customer already has a product). Retry without it.
						log.warn("force_checkout rejected, retrying without it");
						try {
							setup = await autumnAttach({
								customer_id: customerId,
								product_id: selectedPlan,
								success_url: `${baseUrl}/onboarding/complete`,
								cancel_url: `${baseUrl}/onboarding`,
								customer_data: {
									email: context.user.email,
									name: org.name,
								},
							});
						} catch (retryErr) {
							const retryMsg = retryErr instanceof Error ? retryErr.message : "";
							if (
								retryMsg.includes("already scheduled") ||
								retryMsg.includes("can't attach again")
							) {
								log.info("Product already attached on retry, skipping");
							} else {
								throw retryErr;
							}
						}
					} else {
						throw attachErr;
					}
				}

				const checkoutUrl = setup?.checkout_url ?? setup?.url;
				if (checkoutUrl) {
					return {
						success: true,
						checkoutUrl,
						message: "Card required to start trial",
					};
				}

				if (org.billingState === "unconfigured") {
					await orgs.initializeBillingState(context.orgId, "trial", TRIAL_CREDITS);
				}

				return {
					success: true,
					message: "Trial started",
				};
			} catch (err) {
				log.error({ err }, "Failed to start trial");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to start trial",
				});
			}
		}),

	/**
	 * Mark onboarding as complete for the organization.
	 * Called after Stripe checkout completes.
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
				log.error({ err }, "Failed to mark complete");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to complete onboarding",
				});
			}

			return { success: true };
		}),

	/**
	 * Get onboarding status for the current user/organization.
	 */
	getStatus: protectedProcedure.output(OnboardingStatusSchema).handler(async ({ context }) => {
		const orgId = context.session.activeOrganizationId;
		const status = await onboarding.getOnboardingStatus(orgId, NANGO_GITHUB_INTEGRATION_ID);
		return status;
	}),

	/**
	 * Finalize onboarding by selecting repos and creating a managed prebuild.
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

			// Fetch available repos from GitHub to get details
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

			// Upsert repos into database
			const createdRepoIds: string[] = [];

			for (const repo of selectedRepos) {
				try {
					const repoId = await onboarding.upsertRepoFromGitHub(orgId, userId, repo, integrationId);
					createdRepoIds.push(repoId);
				} catch (err) {
					log.error({ err }, "Failed to insert repo");
				}
			}

			if (createdRepoIds.length === 0) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to add any repos",
				});
			}

			// Create managed prebuild with specific repo IDs
			try {
				const gateway = createSyncClient({
					baseUrl: GATEWAY_URL,
					auth: {
						type: "service",
						name: "onboarding-finalize",
						secret: SERVICE_TO_SERVICE_AUTH_TOKEN,
					},
				});

				const prebuild = await getOrCreateManagedPrebuild({
					organizationId: orgId,
					gateway,
					repoIds: createdRepoIds,
				});

				return {
					prebuildId: prebuild.id,
					repoIds: createdRepoIds,
					isNew: prebuild.isNew,
				};
			} catch (err) {
				log.error({ err }, "Failed to create managed prebuild");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: err instanceof Error ? err.message : "Failed to create managed prebuild",
				});
			}
		}),
};
