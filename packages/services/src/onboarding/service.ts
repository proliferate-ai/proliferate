/**
 * Onboarding service.
 *
 * Business logic that orchestrates DB operations.
 */

import { env } from "@proliferate/environment/server";
import { createSyncClient } from "@proliferate/gateway-clients";
import { FREE_CREDITS } from "@proliferate/shared/billing";
import type { OnboardingRepo, OnboardingStatus } from "@proliferate/shared/contracts/onboarding";
import * as configurationsService from "../configurations/service";
import { toIsoString } from "../db/serialize";
import { getServicesLogger } from "../logger";
import { getOrCreateManagedConfiguration } from "../managed-configuration";
import * as orgsDb from "../orgs/db";
import * as orgsService from "../orgs/service";
import type { OnboardingMeta } from "../types/onboarding";
import * as onboardingDb from "./db";

const logger = getServicesLogger().child({ module: "onboarding" });

/** True if the org has never received free credits (first-time setup). */
function needsFreeCredits(org: { shadowBalance: string | null } | null | undefined): boolean {
	return !org || Number(org.shadowBalance ?? 0) === 0;
}

// ============================================
// Types
// ============================================

export interface OnboardingStatusResult extends OnboardingStatus {}

// ============================================
// Service functions
// ============================================

/**
 * Complete onboarding for an organization.
 * Handles billing state initialization and marks all user orgs as complete.
 */
export async function completeOnboarding(orgId: string, userId: string): Promise<void> {
	await orgsService.markOnboardingComplete(orgId, true);

	const org = await orgsService.getBillingInfoV2(orgId);
	if (needsFreeCredits(org)) {
		await orgsService.initializeBillingState(orgId, "free", FREE_CREDITS);
	}

	// Also mark all other orgs the user belongs to as onboarding-complete.
	// This prevents the user from getting stuck in onboarding if their
	// session switches back to a personal workspace or another org.
	try {
		await orgsService.markAllUserOrgsOnboardingComplete(userId);
	} catch (err) {
		logger.warn({ err, userId }, "Failed to mark other orgs complete");
	}
}

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
 * Get onboarding status with auto-complete check.
 * If the org hasn't completed onboarding but the user has another org that has,
 * auto-completes and returns updated status.
 */
export async function getOnboardingStatusWithAutoComplete(
	orgId: string | undefined,
	userId: string,
): Promise<OnboardingStatus> {
	const status = await getOnboardingStatus(orgId);

	if (orgId && !status.onboardingComplete) {
		const autoCompleted = await autoCompleteIfNeeded(orgId, userId);
		if (autoCompleted) {
			status.onboardingComplete = true;
		}
	}

	return status;
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
 * Returns a shape compatible with the web-layer GitHubIntegration type.
 */
export async function getIntegrationForFinalization(
	integrationId: string,
	orgId: string,
): Promise<{
	id: string;
	githubInstallationId: number | null;
	connectionId: string | null;
	provider: string | undefined;
} | null> {
	const integration = await onboardingDb.getIntegration(integrationId, orgId);
	if (!integration) return null;

	return {
		id: integration.id,
		githubInstallationId: integration.githubInstallationId
			? Number(integration.githubInstallationId)
			: null,
		connectionId: integration.connectionId,
		provider: integration.provider ?? undefined,
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
	message?: string;
}

/**
 * Initialize free credits for a new organization.
 * Grants permanent free credits — no CC required, no external billing setup.
 *
 * If billing is not enabled, just marks onboarding complete.
 * Kept as `startTrial` for backward compatibility with callers.
 */
export async function startTrial(input: StartTrialInput): Promise<StartTrialResult> {
	const { orgId, plan: selectedPlan = "dev", billingEnabled } = input;

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
			message: "Billing not configured - free credits initialized without payment",
		};
	}

	const org = await orgsService.getBillingInfoV2(orgId);
	await orgsService.updateBillingPlan(orgId, selectedPlan);

	// Only initialize free credits for first-time setup (never granted before)
	if (needsFreeCredits(org)) {
		await orgsService.initializeBillingState(orgId, "free", FREE_CREDITS);
	}

	return {
		success: true,
		message: "Free credits initialized",
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

/**
 * Finalize onboarding with repo filtering.
 *
 * Accepts the full list of repos from a GitHub fetch and the selected IDs,
 * filters to only selected repos, and delegates to `finalizeOnboarding`.
 * The caller is responsible for fetching GitHub repos (web-only dependency).
 */
export async function finalizeOnboardingWithRepos(input: {
	orgId: string;
	userId: string;
	integrationId: string;
	selectedGithubRepoIds: number[];
	allRepos: Array<{
		id: number;
		full_name: string;
		private: boolean;
		clone_url: string;
		html_url: string;
		default_branch: string;
	}>;
	gatewayUrl: string;
	serviceToken: string;
}): Promise<FinalizeOnboardingResult> {
	const selectedRepos = input.allRepos.filter((repo) =>
		input.selectedGithubRepoIds.includes(repo.id),
	);

	if (selectedRepos.length === 0) {
		throw new Error("None of the selected repos are accessible");
	}

	return finalizeOnboarding({
		orgId: input.orgId,
		userId: input.userId,
		selectedRepos,
		integrationId: input.integrationId,
		gatewayUrl: input.gatewayUrl,
		serviceToken: input.serviceToken,
	});
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

			// Initialize billing for orgs that haven't gone through startTrial
			const org = await orgsService.getBillingInfoV2(orgId);
			if (needsFreeCredits(org)) {
				await orgsService.initializeBillingState(orgId, "free", FREE_CREDITS);
			}

			return true;
		} catch (err) {
			logger.warn({ err, orgId }, "Failed to auto-complete onboarding for org");
		}
	}
	return false;
}
