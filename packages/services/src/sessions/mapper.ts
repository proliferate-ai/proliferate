/**
 * Sessions mapper.
 *
 * Transforms DB rows (camelCase from Drizzle) to API response types (camelCase).
 */

import type { Session } from "@proliferate/shared";
import { toIsoString } from "../db/serialize";
import type { RepoRow, SessionRow, SessionWithRepoRow } from "./db";

/**
 * Map a repo row (camelCase) to the API Repo type (camelCase, minimal version for sessions).
 */
function mapRepo(repo: RepoRow) {
	return {
		id: repo.id,
		organizationId: repo.organizationId,
		githubRepoId: repo.githubRepoId,
		githubRepoName: repo.githubRepoName,
		githubUrl: repo.githubUrl,
		defaultBranch: repo.defaultBranch,
		createdAt: toIsoString(repo.createdAt),
		source: repo.source || "github",
		isPrivate: false, // repos schema doesn't have isPrivate yet
	};
}

/**
 * Map a DB row (camelCase with repo) to API Session type (camelCase).
 */
export function toSession(row: SessionWithRepoRow): Session {
	return {
		id: row.id,
		repoId: row.repoId,
		organizationId: row.organizationId,
		createdBy: row.createdBy,
		sessionType: row.sessionType,
		status: row.status,
		sandboxId: row.sandboxId,
		snapshotId: row.snapshotId,
		configurationId: row.configurationId ?? null,
		branchName: row.branchName,
		parentSessionId: row.parentSessionId,
		title: row.title,
		startedAt: toIsoString(row.startedAt),
		lastActivityAt: toIsoString(row.lastActivityAt),
		pausedAt: toIsoString(row.pausedAt),
		pauseReason: row.pauseReason ?? null,
		origin: row.origin,
		clientType: row.clientType,
		repo: row.repo ? mapRepo(row.repo) : undefined,
	};
}

/**
 * Map multiple DB rows to API Session types.
 */
export function toSessions(rows: SessionWithRepoRow[]): Session[] {
	return rows.map(toSession);
}

/**
 * Map a simple session row (no repo) to partial Session type.
 */
export function toSessionPartial(row: SessionRow): Omit<Session, "repo"> {
	return {
		id: row.id,
		repoId: row.repoId,
		organizationId: row.organizationId,
		createdBy: row.createdBy,
		sessionType: row.sessionType,
		status: row.status,
		sandboxId: row.sandboxId,
		snapshotId: row.snapshotId,
		configurationId: row.configurationId ?? null,
		branchName: row.branchName,
		parentSessionId: row.parentSessionId,
		title: row.title,
		startedAt: toIsoString(row.startedAt),
		lastActivityAt: toIsoString(row.lastActivityAt),
		pausedAt: toIsoString(row.pausedAt),
		pauseReason: row.pauseReason ?? null,
		origin: row.origin,
		clientType: row.clientType,
	};
}
