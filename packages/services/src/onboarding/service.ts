/**
 * Onboarding service.
 *
 * Business logic that orchestrates DB operations.
 */

import { env } from "@proliferate/environment/server";
import { createSyncClient } from "@proliferate/gateway-clients";
import type { OnboardingRepo, OnboardingStatus } from "@proliferate/shared";
import { TRIAL_CREDITS, autumnAttach, autumnCreateCustomer } from "@proliferate/shared/billing";
import * as configurationsService from "../configurations/service";
import { toIsoString } from "../db/serialize";
import { getServicesLogger } from "../logger";
import { getOrCreateManagedConfiguration } from "../managed-configuration";
import * as orgsDb from "../orgs/db";
import * as orgsService from "../orgs/service";
import type { OnboardingMeta } from "../types/onboarding";
import * as onboardingDb from "./db";

const logger = getServicesLogger().child({ module: "onboarding" });

// ============================================
// Types
// ============================================

export interface OnboardingStatusResult extends OnboardingStatus {}

// ============================================
// Service functions
// ============================================

/**
 * Get onboarding status for an organization.
 */
export async function getOnboardingStatus(orgId: string | undefined): Promise<OnboardingStatus> {
	if (!orgId) {
		return {
			hasOrg: false,
			onboardingComplete: false,
			hasSlackConnection: false,
			hasGitHubConnection: false,
			repos: [],
		};
	}

	const [hasSlackConnection, hasGitHubConnection, reposWithStatus, meta, billingInfo] =
		await Promise.all([
			onboardingDb.hasSlackConnection(orgId),
			onboardingDb.hasGitHubConnection(orgId, env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID),
			onboardingDb.getReposWithConfigurationStatus(orgId),
			onboardingDb.getOnboardingMeta(orgId),
			orgsDb.findBillingInfo(orgId),
		]);

	const onboardingComplete = billingInfo?.onboardingComplete ?? false;

	const repos: OnboardingRepo[] = reposWithStatus.map((repo) => ({
		id: repo.id,
		github_repo_name: repo.githubRepoName,
		github_url: repo.githubUrl,
		default_branch: repo.defaultBranch,
		created_at: toIsoString(repo.createdAt),
	}));

	return {
		hasOrg: true,
		onboardingComplete,
		hasSlackConnection,
		hasGitHubConnection,
		repos,
		selectedTools: meta?.selectedTools,
	};
}

/**
 * Save tool selections to onboarding meta.
 */
export async function saveToolSelections(orgId: string, selectedTools: string[]): Promise<void> {
	await onboardingDb.updateOnboardingMeta(orgId, { selectedTools });
}

/**
 * Save questionnaire answers to onboarding meta.
 */
export async function saveQuestionnaire(
	orgId: string,
	data: Pick<OnboardingMeta, "referralSource" | "companyWebsite" | "teamSize">,
): Promise<void> {
	await onboardingDb.updateOnboardingMeta(orgId, data);
}

/**
 * Get integration for finalization.
 */
export async function getIntegrationForFinalization(
	integrationId: string,
	orgId: string,
): Promise<{
	id: string;
	github_installation_id: number | null;
	connection_id: string | null;
	provider: string | null;
} | null> {
	const integration = await onboardingDb.getIntegration(integrationId, orgId);
	if (!integration) return null;

	return {
		id: integration.id,
		github_installation_id: integration.githubInstallationId
			? Number(integration.githubInstallationId)
			: null,
		connection_id: integration.connectionId,
		provider: integration.provider,
	};
}

/**
 * Upsert a repo from GitHub data.
 */
export async function upsertRepoFromGitHub(
	orgId: string,
	userId: string,
	githubRepo: {
		id: number;
		full_name: string;
		html_url: string;
		default_branch: string;
		private: boolean;
	},
	integrationId: string,
): Promise<string> {
	const githubRepoIdStr = String(githubRepo.id);

	// Check if repo already exists
	const existingRepo = await onboardingDb.findRepoByGitHubId(orgId, githubRepoIdStr);

	let repoId: string;
	let isNew = false;

	if (existingRepo) {
		repoId = existingRepo.id;
	} else {
		// Create new repo
		repoId = crypto.randomUUID();
		isNew = true;
		await onboardingDb.createRepo({
			id: repoId,
			organizationId: orgId,
			githubRepoId: githubRepoIdStr,
			githubRepoName: githubRepo.full_name,
			githubUrl: githubRepo.html_url,
			defaultBranch: githubRepo.default_branch,
			addedBy: userId,
			isPrivate: githubRepo.private,
		});
	}

	// Create/update repo connection
	await onboardingDb.upsertRepoConnection(repoId, integrationId);

	if (isNew) {
		// Auto-create a single-repo configuration (which triggers snapshot build)
		void configurationsService
			.createConfiguration({
				organizationId: orgId,
				userId,
				repoIds: [repoId],
			})
			.catch((err) => {
				getServicesLogger()
					.child({ module: "onboarding" })
					.warn({ err, repoId, orgId }, "Failed to auto-create configuration for new repo");
			});
	}

	return repoId;
}

// ============================================
// Trial Start
// ============================================

export interface StartTrialInput {
	orgId: string;
	userId: string;
	userEmail: string;
	orgName: string;
	plan?: "dev" | "pro";
	billingEnabled: boolean;
	appUrl: string;
}

export interface StartTrialResult {
	success: boolean;
	checkoutUrl?: string;
	message?: string;
}

/**
 * Start a credit-based trial for a new organization.
 * Stores the selected plan (dev/pro) and grants trial credits.
 *
 * If billing is not enabled, just marks onboarding complete.
 */
export async function startTrial(input: StartTrialInput): Promise<StartTrialResult> {
	const { orgId, userEmail, plan: selectedPlan = "dev", billingEnabled, appUrl } = input;

	// If billing not configured, just mark onboarding complete
	if (!billingEnabled) {
		try {
			await orgsService.markOnboardingComplete(orgId, true);
			await orgsService.updateBillingPlan(orgId, selectedPlan);
		} catch (err) {
			logger.error({ err }, "Failed to mark onboarding as complete");
		}

		return {
			success: true,
			message: "Billing not configured - trial started without payment",
		};
	}

	// Check if org already has a customer ID
	const org = await orgsService.getBillingInfoV2(orgId);

	if (!org) {
		throw new Error("Failed to check organization billing state");
	}

	await orgsService.updateBillingPlan(orgId, selectedPlan);

	let customerId = org.autumnCustomerId ?? orgId;
	try {
		const customer = await autumnCreateCustomer({
			id: customerId,
			name: org.name,
			email: userEmail,
		});
		customerId = customer.customer?.id ?? customer.data?.id ?? customer.id ?? customerId;
		if (customerId !== org.autumnCustomerId) {
			await orgsService.updateAutumnCustomerId(orgId, customerId);
		}
	} catch (err) {
		logger.warn({ err }, "Failed to create Autumn customer");
	}

	let setup: Awaited<ReturnType<typeof autumnAttach>> | null = null;
	try {
		setup = await autumnAttach({
			customer_id: customerId,
			product_id: selectedPlan,
			success_url: `${appUrl}/onboarding/complete`,
			cancel_url: `${appUrl}/onboarding`,
			customer_data: {
				email: userEmail,
				name: org.name,
			},
			force_checkout: true,
		});
	} catch (attachErr) {
		const msg = attachErr instanceof Error ? attachErr.message : "";
		if (msg.includes("already scheduled") || msg.includes("can't attach again")) {
			logger.info("Product already attached, skipping autumnAttach");
		} else if (msg.includes("force_checkout")) {
			logger.warn("force_checkout rejected, retrying without it");
			try {
				setup = await autumnAttach({
					customer_id: customerId,
					product_id: selectedPlan,
					success_url: `${appUrl}/onboarding/complete`,
					cancel_url: `${appUrl}/onboarding`,
					customer_data: {
						email: userEmail,
						name: org.name,
					},
				});
			} catch (retryErr) {
				const retryMsg = retryErr instanceof Error ? retryErr.message : "";
				if (retryMsg.includes("already scheduled") || retryMsg.includes("can't attach again")) {
					logger.info("Product already attached on retry, skipping");
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
		await orgsService.initializeBillingState(orgId, "trial", TRIAL_CREDITS);
	}

	return {
		success: true,
		message: "Trial started",
	};
}

// ============================================
// Finalize Onboarding
// ============================================

export interface FinalizeOnboardingInput {
	orgId: string;
	userId: string;
	selectedRepos: Array<{
		id: number;
		full_name: string;
		private: boolean;
		clone_url: string;
		html_url: string;
		default_branch: string;
	}>;
	integrationId: string;
	gatewayUrl: string;
	serviceToken: string;
}

export interface FinalizeOnboardingResult {
	configurationId: string;
	repoIds: string[];
	isNew: boolean;
}

/**
 * Finalize onboarding by upserting repos and creating a managed configuration.
 *
 * The caller is responsible for fetching GitHub repos (web-only dependency)
 * and passing the filtered list.
 */
export async function finalizeOnboarding(
	input: FinalizeOnboardingInput,
): Promise<FinalizeOnboardingResult> {
	const { orgId, userId, selectedRepos, integrationId, gatewayUrl, serviceToken } = input;

	// Upsert repos into database
	const createdRepoIds: string[] = [];

	for (const repo of selectedRepos) {
		try {
			const repoId = await upsertRepoFromGitHub(orgId, userId, repo, integrationId);
			createdRepoIds.push(repoId);
		} catch (err) {
			logger.error({ err }, "Failed to insert repo");
		}
	}

	if (createdRepoIds.length === 0) {
		throw new Error("Failed to add any repos");
	}

	// Create managed configuration with specific repo IDs
	const gateway = createSyncClient({
		baseUrl: gatewayUrl,
		auth: {
			type: "service",
			name: "onboarding-finalize",
			secret: serviceToken,
		},
	});

	const configuration = await getOrCreateManagedConfiguration({
		organizationId: orgId,
		gateway,
		repoIds: createdRepoIds,
	});

	return {
		configurationId: configuration.id,
		repoIds: createdRepoIds,
		isNew: configuration.isNew,
	};
}

// ============================================
// Auto-Complete Onboarding
// ============================================

/**
 * Auto-complete onboarding for an org if the user has any other org
 * that has completed onboarding. Prevents onboarding loops when switching orgs.
 */
export async function autoCompleteIfNeeded(orgId: string, userId: string): Promise<boolean> {
	const hasCompleted = await orgsService.hasAnyOrgCompletedOnboarding(userId);
	if (hasCompleted) {
		logger.info(
			{ orgId, userId },
			"Active org not onboarded but user has another completed org — auto-completing",
		);
		try {
			await orgsService.markOnboardingComplete(orgId, true);
			return true;
		} catch (err) {
			logger.warn({ err, orgId }, "Failed to auto-complete onboarding for org");
		}
	}
	return false;
}
