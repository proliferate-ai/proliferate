/**
 * Repos DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import { and, desc, eq, getDb, repoConnections, repos } from "../db/client";
import type { InferSelectModel } from "../db/client";
import type { DbCreateRepoInput } from "../types/repos";

// Type alias for Drizzle model
export type RepoRow = InferSelectModel<typeof repos>;

// Type for repo with configurations (from relation query)
export interface RepoWithConfigurationsRow extends RepoRow {
	configurationRepos?: Array<{
		configuration: {
			id: string;
			status: string | null;
			snapshotId: string | null;
		} | null;
	}>;
}

// ============================================
// Queries
// ============================================

/**
 * List repos for an organization with configuration status.
 */
export async function listByOrganization(orgId: string): Promise<RepoWithConfigurationsRow[]> {
	const db = getDb();
	const results = await db.query.repos.findMany({
		where: eq(repos.organizationId, orgId),
		orderBy: [desc(repos.createdAt)],
		with: {
			configurationRepos: {
				with: {
					configuration: {
						columns: {
							id: true,
							status: true,
							snapshotId: true,
						},
					},
				},
			},
		},
	});

	return results;
}

/**
 * Get a single repo by ID with configuration status.
 */
export async function findById(
	id: string,
	orgId: string,
): Promise<RepoWithConfigurationsRow | null> {
	const db = getDb();
	const result = await db.query.repos.findFirst({
		where: and(eq(repos.id, id), eq(repos.organizationId, orgId)),
		with: {
			configurationRepos: {
				with: {
					configuration: {
						columns: {
							id: true,
							status: true,
							snapshotId: true,
						},
					},
				},
			},
		},
	});

	return result ?? null;
}

/**
 * Find repo by GitHub repo ID within an organization.
 */
export async function findByGithubRepoId(
	orgId: string,
	githubRepoId: string,
): Promise<RepoRow | null> {
	const db = getDb();
	const result = await db.query.repos.findFirst({
		where: and(eq(repos.organizationId, orgId), eq(repos.githubRepoId, githubRepoId)),
	});

	return result ?? null;
}

/**
 * Create a new repo.
 */
export async function create(input: DbCreateRepoInput): Promise<RepoRow> {
	const db = getDb();
	const [result] = await db
		.insert(repos)
		.values({
			id: input.id,
			organizationId: input.organizationId,
			githubRepoId: input.githubRepoId,
			githubRepoName: input.githubRepoName,
			githubUrl: input.githubUrl,
			defaultBranch: input.defaultBranch,
			addedBy: input.addedBy,
			source: input.source || "github",
		})
		.returning();

	return result;
}

/**
 * Delete a repo.
 */
export async function deleteById(id: string, orgId: string): Promise<void> {
	const db = getDb();
	await db.delete(repos).where(and(eq(repos.id, id), eq(repos.organizationId, orgId)));
}

/**
 * Update repo's orphaned status.
 */
export async function updateOrphanedStatus(id: string, isOrphaned: boolean): Promise<void> {
	const db = getDb();
	await db.update(repos).set({ isOrphaned, updatedAt: new Date() }).where(eq(repos.id, id));
}

/**
 * Create a repo connection (link repo to integration).
 */
export async function createConnection(repoId: string, integrationId: string): Promise<void> {
	const db = getDb();
	await db.insert(repoConnections).values({ repoId, integrationId }).onConflictDoNothing();
}

/**
 * Check if repo exists (just ID check).
 */
export async function exists(id: string, orgId: string): Promise<boolean> {
	const db = getDb();
	const result = await db.query.repos.findFirst({
		where: and(eq(repos.id, id), eq(repos.organizationId, orgId)),
		columns: { id: true },
	});

	return !!result;
}

/**
 * Get repo's organization_id.
 */
export async function getOrganizationId(repoId: string): Promise<string | null> {
	const db = getDb();
	const result = await db.query.repos.findFirst({
		where: eq(repos.id, repoId),
		columns: { organizationId: true },
	});

	return result?.organizationId || null;
}

/**
 * Get repo's github_repo_name by ID.
 */
export async function getGithubRepoName(repoId: string): Promise<string | null> {
	const db = getDb();
	const result = await db.query.repos.findFirst({
		where: eq(repos.id, repoId),
		columns: { githubRepoName: true },
	});

	return result?.githubRepoName || null;
}

/**
 * Get service commands for a repo.
 * Returns raw jsonb — caller must validate with parseServiceCommands().
 */
export async function getServiceCommands(
	repoId: string,
	orgId: string,
): Promise<{ serviceCommands: unknown } | null> {
	const db = getDb();
	const result = await db.query.repos.findFirst({
		where: and(eq(repos.id, repoId), eq(repos.organizationId, orgId)),
		columns: { serviceCommands: true },
	});
	return result ?? null;
}

/**
 * Update service commands for a repo.
 */
export async function updateServiceCommands(input: {
	repoId: string;
	orgId: string;
	serviceCommands: unknown;
	updatedBy: string;
}): Promise<void> {
	const db = getDb();
	await db
		.update(repos)
		.set({
			serviceCommands: input.serviceCommands,
			serviceCommandsUpdatedAt: new Date(),
			serviceCommandsUpdatedBy: input.updatedBy,
			updatedAt: new Date(),
		})
		.where(and(eq(repos.id, input.repoId), eq(repos.organizationId, input.orgId)));
}
