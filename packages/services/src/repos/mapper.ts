/**
 * Repos mapper.
 *
 * Transforms DB rows (camelCase from Drizzle) to API response types (camelCase).
 */

import type { Repo } from "@proliferate/shared";
import { toIsoString } from "../db/serialize";
import type { RepoRow, RepoWithConfigurationsRow } from "./db";

/**
 * Map a DB row (with configurations) to API Repo type.
 */
export function toRepo(row: RepoWithConfigurationsRow): Repo {
	return {
		id: row.id,
		organizationId: row.organizationId,
		githubRepoId: row.githubRepoId,
		githubRepoName: row.githubRepoName,
		githubUrl: row.githubUrl,
		defaultBranch: row.defaultBranch,
		createdAt: toIsoString(row.createdAt),
		updatedAt: toIsoString(row.updatedAt),
		isPrivate: row.isPrivate ?? false,
	};
}

/**
 * Map multiple DB rows to API Repo types.
 */
export function toRepos(rows: RepoWithConfigurationsRow[]): Repo[] {
	return rows.map(toRepo);
}

/**
 * Map a simple repo row (no configurations) to partial Repo type.
 */
export function toRepoPartial(row: RepoRow): Partial<Repo> {
	return {
		id: row.id,
		organizationId: row.organizationId,
		githubRepoId: row.githubRepoId,
		githubRepoName: row.githubRepoName,
		githubUrl: row.githubUrl,
		defaultBranch: row.defaultBranch,
		createdAt: toIsoString(row.createdAt),
		isPrivate: row.isPrivate ?? false,
	};
}
