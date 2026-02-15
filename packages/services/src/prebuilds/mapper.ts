/**
 * Prebuilds mapper.
 *
 * Transforms DB rows (camelCase) to API response types (camelCase).
 */

import type { Prebuild } from "@proliferate/shared";
import { toIsoString } from "../db/serialize";
import type { PrebuildRow, PrebuildWithRelationsRow } from "./db";

/**
 * Map a DB row to API Prebuild type.
 */
export function toPrebuild(row: PrebuildWithRelationsRow): Prebuild {
	return {
		id: row.id,
		snapshotId: row.snapshotId,
		status: row.status,
		name: row.name,
		notes: row.notes,
		createdAt: toIsoString(row.createdAt),
		createdBy: row.createdBy,
		sandboxProvider: null, // Field removed from schema
		prebuildRepos: row.configurationRepos?.map((pr) => ({
			workspacePath: pr.workspacePath,
			repo: pr.repo
				? {
						id: pr.repo.id,
						githubRepoName: pr.repo.githubRepoName,
						githubUrl: pr.repo.githubUrl,
					}
				: null,
		})),
		setupSessions: row.sessions?.map((s) => ({
			id: s.id,
			sessionType: s.sessionType,
			status: s.status,
		})),
	};
}

/**
 * Map multiple DB rows to API Prebuild types.
 */
export function toPrebuilds(rows: PrebuildWithRelationsRow[]): Prebuild[] {
	return rows.map(toPrebuild);
}

/**
 * Map a simple prebuild row (no relations) to partial Prebuild type.
 */
export function toPrebuildPartial(row: PrebuildRow): Partial<Prebuild> {
	return {
		id: row.id,
		snapshotId: row.snapshotId,
		status: row.status,
		name: row.name,
		notes: row.notes,
		createdAt: toIsoString(row.createdAt),
		createdBy: row.createdBy,
		sandboxProvider: null, // Field removed from schema
	};
}
