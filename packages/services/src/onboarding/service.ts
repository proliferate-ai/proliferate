/**
 * Onboarding service.
 *
 * Business logic that orchestrates DB operations.
 */

import type { OnboardingRepo, OnboardingStatus } from "@proliferate/shared";
import * as configurationsService from "../configurations/service";
import { toIsoString } from "../db/serialize";
import * as orgsDb from "../orgs/db";
import type { OnboardingMeta } from "../types/onboarding";
import * as onboardingDb from "./db";

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
export async function getOnboardingStatus(
	orgId: string | undefined,
	nangoGithubIntegrationId?: string,
): Promise<OnboardingStatus> {
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
			onboardingDb.hasGitHubConnection(orgId, nangoGithubIntegrationId),
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
		void configurationsService.createConfiguration({
			organizationId: orgId,
			userId,
			repoIds: [repoId],
		});
	}

	return repoId;
}
