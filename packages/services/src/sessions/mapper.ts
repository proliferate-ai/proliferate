/**
 * Sessions mapper.
 *
 * Transforms DB rows (camelCase from Drizzle) to API response types (camelCase).
 */

import type { Session } from "@proliferate/shared/contracts/sessions";
import { sanitizePromptSnippet } from "@proliferate/shared/sessions";
import { toIsoString } from "../db/serialize";
import type { EnrichedSessionRow, RepoRow, SessionRow, SessionWithRepoRow } from "./db";

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

function toSessionKind(kind: string | null): Session["kind"] {
	return kind === "manager" || kind === "task" || kind === "setup" ? kind : null;
}

type CanonicalStatusRow = Pick<
	SessionRow,
	"sandboxState" | "agentState" | "terminalState" | "stateReason" | "stateUpdatedAt"
>;

export function toCanonicalStatus(row: CanonicalStatusRow): Session["status"] {
	const agentState =
		row.agentState === "iterating" ||
		row.agentState === "waiting_input" ||
		row.agentState === "waiting_approval" ||
		row.agentState === "done" ||
		row.agentState === "errored"
			? row.agentState
			: "errored";
	const terminalState =
		row.terminalState === "succeeded" ||
		row.terminalState === "failed" ||
		row.terminalState === "cancelled"
			? row.terminalState
			: null;
	const reason =
		row.stateReason === "manual_pause" ||
		row.stateReason === "inactivity" ||
		row.stateReason === "approval_required" ||
		row.stateReason === "orphaned" ||
		row.stateReason === "snapshot_failed" ||
		row.stateReason === "automation_completed" ||
		row.stateReason === "credit_limit" ||
		row.stateReason === "payment_failed" ||
		row.stateReason === "overage_cap" ||
		row.stateReason === "suspended" ||
		row.stateReason === "cancelled_by_user" ||
		row.stateReason === "runtime_error"
			? row.stateReason
			: null;

	return {
		sandboxState:
			row.sandboxState === "provisioning" ||
			row.sandboxState === "running" ||
			row.sandboxState === "paused" ||
			row.sandboxState === "terminated" ||
			row.sandboxState === "failed"
				? row.sandboxState
				: "failed",
		agentState,
		terminalState,
		reason,
		isTerminal: terminalState !== null,
		agentFinishedIterating: agentState !== "iterating",
		requiresHumanReview:
			agentState === "waiting_input" ||
			agentState === "waiting_approval" ||
			agentState === "errored",
		updatedAt: toIsoString(row.stateUpdatedAt),
	};
}

/**
 * Map a DB row (camelCase with repo) to API Session type (camelCase).
 */
export function toSession(
	row: SessionWithRepoRow | EnrichedSessionRow,
	options?: ToSessionOptions,
): Session {
	const enriched = isEnrichedRow(row);
	return {
		id: row.id,
		repoId: row.repoId,
		organizationId: row.organizationId,
		createdBy: row.createdBy,
		creator: null,
		kind: toSessionKind(row.kind),
		sessionType: row.sessionType,
		status: toCanonicalStatus(row),
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
		// V1: enrichment fields
		workerId: row.workerId ?? null,
		workerName: enriched ? row.workerName : null,
		visibility: (row.visibility as Session["visibility"]) ?? null,
		continuedFromSessionId: row.continuedFromSessionId ?? null,
		rerunOfSessionId: row.rerunOfSessionId ?? null,
		unread: enriched ? row.isUnread : undefined,
		hasUnreadUpdate: enriched ? row.isUnread : undefined,
		pendingApprovalCount: enriched ? row.pendingApprovalCount : undefined,
	};
}

function isEnrichedRow(row: SessionWithRepoRow | EnrichedSessionRow): row is EnrichedSessionRow {
	return "isUnread" in row;
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
		creator: null,
		kind: toSessionKind(row.kind),
		sessionType: row.sessionType,
		status: toCanonicalStatus(row),
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
		// V1: enrichment fields (partial row — no enrichment data available)
		workerId: row.workerId ?? null,
		visibility: (row.visibility as Session["visibility"]) ?? null,
		continuedFromSessionId: row.continuedFromSessionId ?? null,
		rerunOfSessionId: row.rerunOfSessionId ?? null,
	};
}
