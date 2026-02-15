/**
 * Onboarding DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import {
	and,
	desc,
	eq,
	getDb,
	inArray,
	integrations,
	repoConnections,
	repos,
	slackInstallations,
} from "../db/client";
import type { IntegrationRow, RepoWithConfigurationRow } from "../types/onboarding";

// ============================================
// Queries
// ============================================

/**
 * Check if Slack is connected for an organization.
 */
export async function hasSlackConnection(orgId: string): Promise<boolean> {
	const db = getDb();
	const result = await db.query.slackInstallations.findFirst({
		where: and(
			eq(slackInstallations.organizationId, orgId),
			eq(slackInstallations.status, "active"),
		),
		columns: { id: true },
	});
	return !!result;
}

/**
 * Check if GitHub is connected for an organization.
 */
export async function hasGitHubConnection(
	orgId: string,
	nangoGithubIntegrationId?: string,
): Promise<boolean> {
	const db = getDb();
	const integrationIds = ["github-app", nangoGithubIntegrationId].filter(Boolean) as string[];
	const result = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.organizationId, orgId),
			inArray(integrations.integrationId, integrationIds),
			eq(integrations.status, "active"),
		),
		columns: { id: true },
	});
	return !!result;
}

/**
 * Get repos with configuration status for an organization.
 */
export async function getReposWithConfigurationStatus(
	orgId: string,
): Promise<RepoWithConfigurationRow[]> {
	const db = getDb();
	const results = await db.query.repos.findMany({
		where: eq(repos.organizationId, orgId),
		orderBy: [desc(repos.createdAt)],
		columns: {
			id: true,
			githubRepoName: true,
			githubUrl: true,
			defaultBranch: true,
			createdAt: true,
		},
		with: {
			configurationRepos: {
				with: {
					configuration: {
						columns: {
							id: true,
							activeSnapshotId: true,
						},
					},
				},
			},
		},
	});
	return results;
}

/**
 * Get integration by ID with GitHub info.
 */
export async function getIntegration(
	integrationId: string,
	orgId: string,
): Promise<IntegrationRow | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.id, integrationId),
			eq(integrations.organizationId, orgId),
			eq(integrations.status, "active"),
		),
		columns: {
			id: true,
			githubInstallationId: true,
			connectionId: true,
			provider: true,
		},
	});
	return result ?? null;
}

/**
 * Check if a repo exists for an organization by GitHub repo ID.
 */
export async function findRepoByGitHubId(
	orgId: string,
	githubRepoId: string,
): Promise<{ id: string } | null> {
	const db = getDb();
	const result = await db.query.repos.findFirst({
		where: and(eq(repos.organizationId, orgId), eq(repos.githubRepoId, githubRepoId)),
		columns: { id: true },
	});
	return result ?? null;
}

/**
 * Create a new repo.
 */
export async function createRepo(input: {
	id: string;
	organizationId: string;
	githubRepoId: string;
	githubRepoName: string;
	githubUrl: string;
	defaultBranch: string;
	isPrivate: boolean;
}): Promise<void> {
	const db = getDb();
	await db.insert(repos).values({
		id: input.id,
		organizationId: input.organizationId,
		githubRepoId: input.githubRepoId,
		githubRepoName: input.githubRepoName,
		githubUrl: input.githubUrl,
		defaultBranch: input.defaultBranch,
	});
}

/**
 * Upsert repo connection.
 */
export async function upsertRepoConnection(repoId: string, integrationId: string): Promise<void> {
	const db = getDb();
	await db
		.insert(repoConnections)
		.values({
			repoId,
			integrationId,
		})
		.onConflictDoNothing({
			target: [repoConnections.repoId, repoConnections.integrationId],
		});
}
