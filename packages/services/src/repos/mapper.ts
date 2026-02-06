/**
 * Repos mapper.
 *
 * Transforms DB rows (camelCase from Drizzle) to API response types (camelCase).
 */

import type { Repo } from "@proliferate/shared";
import { toIsoString } from "../db/serialize";
import type { RepoRow, RepoWithPrebuildsRow } from "./db";

/**
 * Check if a prebuild_repos entry has a usable snapshot.
 */
function hasUsablePrebuild(pr: { prebuild: { snapshotId: string | null } | null }): boolean {
	return !!pr.prebuild?.snapshotId;
}

/**
 * Map a DB row (with prebuilds) to API Repo type.
 */
export function toRepo(row: RepoWithPrebuildsRow): Repo {
	const readyPrebuild = row.prebuildRepos?.find(hasUsablePrebuild);

	return {
		id: row.id,
		organizationId: row.organizationId,
		githubRepoId: row.githubRepoId,
		githubRepoName: row.githubRepoName,
		githubUrl: row.githubUrl,
		defaultBranch: row.defaultBranch,
		createdAt: toIsoString(row.createdAt),
		source: row.source || "github",
		isPrivate: false, // Field not in Drizzle schema, default to false for API compatibility
		prebuildStatus: readyPrebuild ? "ready" : "pending",
		prebuildId: readyPrebuild?.prebuild?.id || null,
	};
}

/**
 * Map multiple DB rows to API Repo types.
 */
export function toRepos(rows: RepoWithPrebuildsRow[]): Repo[] {
	return rows.map(toRepo);
}

/**
 * Map a simple repo row (no prebuilds) to partial Repo type.
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
		source: row.source || "github",
		isPrivate: false, // Field not in Drizzle schema, default to false for API compatibility
	};
}
