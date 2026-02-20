/**
 * Sessions mapper.
 *
 * Transforms DB rows (camelCase from Drizzle) to API response types (camelCase).
 */

import type { Session } from "@proliferate/shared";
import { sanitizePromptSnippet } from "@proliferate/shared/sessions";
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
 * Build a Slack thread deep-link URL from session client metadata.
 * Returns null for non-Slack sessions or missing metadata.
 */
function buildSlackThreadUrl(clientType: string | null, clientMetadata: unknown): string | null {
	if (clientType !== "slack" || !clientMetadata || typeof clientMetadata !== "object") return null;
	const meta = clientMetadata as Record<string, unknown>;
	const channelId = meta.channelId;
	const threadTs = meta.threadTs;
	if (typeof channelId !== "string" || typeof threadTs !== "string") return null;
	// Slack thread URL format: https://slack.com/archives/{channelId}/p{threadTs without dot}
	const tsNoDot = threadTs.replace(".", "");
	return `https://slack.com/archives/${channelId}/p${tsNoDot}`;
}

interface ToSessionOptions {
	/** Include the full initialPrompt field (detail path only). */
	includeInitialPrompt?: boolean;
}

/**
 * Map a DB row (camelCase with repo) to API Session type (camelCase).
 */
export function toSession(row: SessionWithRepoRow, options?: ToSessionOptions): Session {
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
		configurationName: row.configuration?.name ?? null,
		branchName: row.branchName,
		parentSessionId: row.parentSessionId,
		title: row.title,
		titleStatus: row.titleStatus ?? null,
		startedAt: toIsoString(row.startedAt),
		lastActivityAt: toIsoString(row.lastActivityAt),
		endedAt: toIsoString(row.endedAt),
		pausedAt: toIsoString(row.pausedAt),
		pauseReason: row.pauseReason ?? null,
		promptSnippet: sanitizePromptSnippet(row.initialPrompt),
		...(options?.includeInitialPrompt ? { initialPrompt: row.initialPrompt ?? null } : {}),
		origin: row.origin,
		clientType: row.clientType,
		automationId: row.automationId ?? null,
		automation: row.automation ? { id: row.automation.id, name: row.automation.name } : null,
		slackThreadUrl: buildSlackThreadUrl(row.clientType, row.clientMetadata),
		repo: row.repo ? mapRepo(row.repo) : undefined,
		// Phase 2a: session telemetry
		outcome: (row.outcome as Session["outcome"]) ?? null,
		summary: row.summary ?? null,
		prUrls: (row.prUrls as string[] | null) ?? null,
		metrics:
			(row.metrics as {
				toolCalls: number;
				messagesExchanged: number;
				activeSeconds: number;
			} | null) ?? null,
		latestTask: row.latestTask ?? null,
	};
}

/**
 * Map multiple DB rows to API Session types.
 */
export function toSessions(rows: SessionWithRepoRow[]): Session[] {
	return rows.map((row) => toSession(row));
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
		configurationName: null,
		branchName: row.branchName,
		parentSessionId: row.parentSessionId,
		title: row.title,
		titleStatus: row.titleStatus ?? null,
		startedAt: toIsoString(row.startedAt),
		lastActivityAt: toIsoString(row.lastActivityAt),
		endedAt: toIsoString(row.endedAt),
		pausedAt: toIsoString(row.pausedAt),
		pauseReason: row.pauseReason ?? null,
		promptSnippet: sanitizePromptSnippet(row.initialPrompt),
		origin: row.origin,
		clientType: row.clientType,
		automationId: row.automationId ?? null,
		automation: null,
		slackThreadUrl: buildSlackThreadUrl(row.clientType, row.clientMetadata),
		// Phase 2a: session telemetry
		outcome: (row.outcome as Session["outcome"]) ?? null,
		summary: row.summary ?? null,
		prUrls: (row.prUrls as string[] | null) ?? null,
		metrics:
			(row.metrics as {
				toolCalls: number;
				messagesExchanged: number;
				activeSeconds: number;
			} | null) ?? null,
		latestTask: row.latestTask ?? null,
	};
}
