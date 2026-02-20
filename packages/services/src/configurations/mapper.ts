/**
 * Configurations mapper.
 *
 * Transforms DB rows (camelCase) to API response types (camelCase).
 */

import type { Configuration } from "@proliferate/shared";
import { toIsoString } from "../db/serialize";
import type { ConfigurationRow, ConfigurationWithRelationsRow } from "./db";

/**
 * Map a DB row to API Configuration type.
 */
export function toConfiguration(row: ConfigurationWithRelationsRow): Configuration {
	return {
		id: row.id,
		snapshotId: row.snapshotId,
		status: row.status,
		name: row.name,
		notes: row.notes,
		routingDescription: row.routingDescription ?? null,
		createdAt: toIsoString(row.createdAt),
		createdBy: row.createdBy,
		sandboxProvider: null, // Field removed from schema
		configurationRepos: row.configurationRepos?.map((pr) => ({
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
 * Map multiple DB rows to API Configuration types.
 */
export function toConfigurations(rows: ConfigurationWithRelationsRow[]): Configuration[] {
	return rows.map(toConfiguration);
}

/**
 * Map a simple configuration row (no relations) to partial Configuration type.
 */
export function toConfigurationPartial(row: ConfigurationRow): Partial<Configuration> {
	return {
		id: row.id,
		snapshotId: row.snapshotId,
		status: row.status,
		name: row.name,
		notes: row.notes,
		routingDescription: row.routingDescription ?? null,
		createdAt: toIsoString(row.createdAt),
		createdBy: row.createdBy,
		sandboxProvider: null, // Field removed from schema
	};
}
