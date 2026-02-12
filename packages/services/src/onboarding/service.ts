/**
 * Onboarding service.
 *
 * Business logic that orchestrates DB operations.
 */

import type { OnboardingRepo, OnboardingStatus } from "@proliferate/shared";
import { toIsoString } from "../db/serialize";
import { requestRepoSnapshotBuild } from "../repos";
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
			hasSlackConnection: false,
			hasGitHubConnection: false,
			repos: [],
		};
	}

	const [hasSlackConnection, hasGitHubConnection, reposWithStatus] = await Promise.all([
		onboardingDb.hasSlackConnection(orgId),
		onboardingDb.hasGitHubConnection(orgId, nangoGithubIntegrationId),
		onboardingDb.getReposWithPrebuildStatus(orgId),
	]);

	// Helper to check if a prebuild_repo entry has a usable prebuild (has snapshot)
	const hasUsablePrebuild = (pr: {
		prebuild: { snapshotId: string | null } | null;
	}): boolean => !!pr.prebuild?.snapshotId;

	// Transform to include prebuild status
	const repos: OnboardingRepo[] = reposWithStatus.map((repo) => {
		const readyPrebuild = repo.prebuildRepos?.find(hasUsablePrebuild);
		return {
			id: repo.id,
			github_repo_name: repo.githubRepoName,
			github_url: repo.githubUrl,
			default_branch: repo.defaultBranch,
			created_at: toIsoString(repo.createdAt),
			prebuild_id: readyPrebuild?.prebuild?.id || null,
			prebuild_status: readyPrebuild ? ("ready" as const) : ("pending" as const),
		};
	});

	return {
		hasOrg: true,
		hasSlackConnection,
		hasGitHubConnection,
		repos,
	};
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
		void requestRepoSnapshotBuild(repoId);
	}

	return repoId;
}
