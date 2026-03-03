/**
 * Sessions V1 service.
 *
 * Business rules for V1 task session creation, follow-up routing,
 * queued session-message delivery, and terminal outcome persistence.
 */

import { randomUUID } from "crypto";
import {
	type SessionRuntimeStatus,
	isTerminalSessionRuntimeStatus,
} from "@proliferate/shared/contracts";
import type { SessionMessageRow, SessionRow } from "./v1-db";
import * as v1Db from "./v1-db";

export class SessionNotFoundError extends Error {
	constructor(sessionId: string) {
		super(`Session not found: ${sessionId}`);
	}
}

export class SessionKindError extends Error {
	constructor(expected: string, actual: string | null | undefined) {
		super(`Invalid session kind: expected ${expected}, received ${actual ?? "null"}`);
	}
}

export class SessionRuntimeStatusError extends Error {}

export interface CreateUnifiedTaskSessionInput extends v1Db.CreateTaskSessionInput {}

export async function createUnifiedTaskSession(
	input: CreateUnifiedTaskSessionInput,
): Promise<SessionRow> {
	return v1Db.createTaskSession({
		id: input.id ?? randomUUID(),
		organizationId: input.organizationId,
		createdBy: input.createdBy,
		repoId: input.repoId,
		repoBaselineId: input.repoBaselineId,
		repoBaselineTargetId: input.repoBaselineTargetId,
		workerId: input.workerId ?? null,
		workerRunId: input.workerRunId ?? null,
		parentSessionId: input.parentSessionId ?? null,
		continuedFromSessionId: input.continuedFromSessionId ?? null,
		rerunOfSessionId: input.rerunOfSessionId ?? null,
		configurationId: input.configurationId ?? null,
		visibility: input.visibility ?? "private",
		initialPrompt: input.initialPrompt ?? null,
		title: input.title ?? null,
		sandboxProvider: input.sandboxProvider,
	});
}

export interface SendTaskFollowupInput {
	sessionId: string;
	organizationId: string;
	userId: string;
	messageType: string;
	payloadJson: unknown;
	dedupeKey?: string;
	deliverAfter?: Date;
	terminalMode?: "continuation" | "rerun";
}

export interface SendTaskFollowupResult {
	deliverySessionId: string;
	mode: "same_session" | "continuation" | "rerun";
	sessionMessage: SessionMessageRow;
}

/**
 * Follow-up contract:
 * - Live task session => follow-up stays in the same task session.
 * - Terminal task session => create ad-hoc continuation by default (`workerId=null`, `workerRunId=null`).
 * - Rerun mode is opt-in (`terminalMode="rerun"`).
 */
export async function sendTaskFollowup(
	input: SendTaskFollowupInput,
): Promise<SendTaskFollowupResult> {
	const source = await v1Db.findSessionById(input.sessionId, input.organizationId);
	if (!source) {
		throw new SessionNotFoundError(input.sessionId);
	}
	if (source.kind !== "task") {
		throw new SessionKindError("task", source.kind);
	}

	const runtimeStatus = (source.runtimeStatus ?? "starting") as SessionRuntimeStatus;
	if (!isTerminalSessionRuntimeStatus(runtimeStatus)) {
		const sameSessionMessage = await v1Db.enqueueSessionMessage({
			sessionId: source.id,
			direction: "user_to_task",
			messageType: input.messageType,
			payloadJson: input.payloadJson,
			dedupeKey: input.dedupeKey,
			deliverAfter: input.deliverAfter,
			senderUserId: input.userId,
		});

		return {
			deliverySessionId: source.id,
			mode: "same_session",
			sessionMessage: sameSessionMessage,
		};
	}

	if (!source.repoId || !source.repoBaselineId || !source.repoBaselineTargetId) {
		throw new SessionRuntimeStatusError(
			"Terminal task follow-up requires repo + baseline linkage on the source session",
		);
	}

	const mode: SendTaskFollowupResult["mode"] =
		input.terminalMode === "rerun" ? "rerun" : "continuation";
	if (input.dedupeKey) {
		const existing = await v1Db.findTerminalFollowupMessageByDedupe({
			organizationId: input.organizationId,
			sourceSessionId: source.id,
			dedupeKey: input.dedupeKey,
			mode,
		});
		if (existing) {
			return {
				deliverySessionId: existing.deliverySessionId,
				mode,
				sessionMessage: existing.sessionMessage,
			};
		}

		const existingFollowupSession = await v1Db.findLatestTerminalFollowupSession({
			organizationId: input.organizationId,
			sourceSessionId: source.id,
			mode,
		});
		if (existingFollowupSession) {
			const existingFollowupMessage = await v1Db.enqueueSessionMessage({
				sessionId: existingFollowupSession.id,
				direction: "user_to_task",
				messageType: input.messageType,
				payloadJson: input.payloadJson,
				dedupeKey: input.dedupeKey,
				deliverAfter: input.deliverAfter,
				senderUserId: input.userId,
			});
			return {
				deliverySessionId: existingFollowupSession.id,
				mode,
				sessionMessage: existingFollowupMessage,
			};
		}
	}

	const nextTask = await createUnifiedTaskSession({
		organizationId: input.organizationId,
		createdBy: input.userId,
		repoId: source.repoId,
		repoBaselineId: source.repoBaselineId,
		repoBaselineTargetId: source.repoBaselineTargetId,
		visibility: (source.visibility as "private" | "shared" | "org") ?? "private",
		continuedFromSessionId: mode === "continuation" ? source.id : null,
		rerunOfSessionId: mode === "rerun" ? source.id : null,
		workerId: null,
		workerRunId: null,
		initialPrompt: null,
	});

	const nextSessionMessage = await v1Db.enqueueSessionMessage({
		sessionId: nextTask.id,
		direction: "user_to_task",
		messageType: input.messageType,
		payloadJson: input.payloadJson,
		dedupeKey: input.dedupeKey,
		deliverAfter: input.deliverAfter,
		senderUserId: input.userId,
	});

	return {
		deliverySessionId: nextTask.id,
		mode,
		sessionMessage: nextSessionMessage,
	};
}

export async function claimQueuedSessionMessagesForDelivery(
	sessionId: string,
	limit = 50,
): Promise<SessionMessageRow[]> {
	return v1Db.claimDeliverableSessionMessages(sessionId, limit);
}

export async function markSessionMessageConsumed(
	sessionMessageId: string,
): Promise<SessionMessageRow | undefined> {
	return v1Db.transitionSessionMessageDeliveryState({
		id: sessionMessageId,
		fromStates: ["delivered"],
		toState: "consumed",
		fields: {
			consumedAt: new Date(),
		},
	});
}

export async function markSessionMessageFailed(input: {
	sessionMessageId: string;
	failureReason: string;
}): Promise<SessionMessageRow | undefined> {
	return v1Db.transitionSessionMessageDeliveryState({
		id: input.sessionMessageId,
		fromStates: ["queued", "delivered"],
		toState: "failed",
		fields: {
			failedAt: new Date(),
			failureReason: input.failureReason,
		},
	});
}

export async function persistTerminalTaskOutcome(input: {
	sessionId: string;
	organizationId: string;
	outcomeJson: unknown;
	outcomeVersion?: number;
}): Promise<{
	outcomeJson: unknown;
	outcomeVersion: number | null;
	outcomePersistedAt: Date | null;
}> {
	const session = await v1Db.findSessionById(input.sessionId, input.organizationId);
	if (!session) {
		throw new SessionNotFoundError(input.sessionId);
	}
	if (session.kind !== "task") {
		throw new SessionKindError("task", session.kind);
	}
	if (!isTerminalSessionRuntimeStatus(session.runtimeStatus as SessionRuntimeStatus)) {
		throw new SessionRuntimeStatusError(
			`Session ${input.sessionId} is not terminal (runtimeStatus=${session.runtimeStatus})`,
		);
	}

	const outcome = await v1Db.persistSessionOutcome({
		sessionId: input.sessionId,
		outcomeJson: input.outcomeJson,
		outcomeVersion: input.outcomeVersion,
	});
	return {
		outcomeJson: outcome.outcomeJson,
		outcomeVersion: outcome.outcomeVersion ?? null,
		outcomePersistedAt: outcome.outcomePersistedAt ?? null,
	};
}

// ============================================
// K2: Session access check
// ============================================

export class SessionAccessDeniedError extends Error {
	constructor(sessionId: string) {
		super(`Access denied to session: ${sessionId}`);
		this.name = "SessionAccessDeniedError";
	}
}

/**
 * Check if a user can access a session based on visibility + ACL.
 * - Creator always has access.
 * - org visibility: all org members can view.
 * - shared visibility: explicit ACL only.
 * - private visibility: creator + explicit ACL only.
 *
 * Returns the user's effective role or null if no access.
 */
export async function getSessionAccessRole(input: {
	sessionId: string;
	organizationId: string;
	userId: string;
}): Promise<string | null> {
	const session = await v1Db.findSessionById(input.sessionId, input.organizationId);
	if (!session) {
		return null;
	}

	// Creator always has full access
	if (session.createdBy === input.userId) {
		return "owner";
	}

	// Check explicit ACL
	const aclRole = await v1Db.getSessionAclRole(input.sessionId, input.userId);
	if (aclRole) {
		return aclRole;
	}

	// org visibility: all org members get viewer-only
	if (session.visibility === "org") {
		return "viewer";
	}

	// private/shared with no explicit ACL: no access
	return null;
}

/**
 * Assert that a user can access a session. Throws if denied.
 */
export async function assertSessionAccess(input: {
	sessionId: string;
	organizationId: string;
	userId: string;
	requiredRole?: string;
}): Promise<string> {
	const role = await getSessionAccessRole({
		sessionId: input.sessionId,
		organizationId: input.organizationId,
		userId: input.userId,
	});
	if (!role) {
		throw new SessionAccessDeniedError(input.sessionId);
	}
	if (input.requiredRole) {
		const roleHierarchy: Record<string, number> = {
			viewer: 1,
			editor: 2,
			reviewer: 3,
			owner: 4,
		};
		if ((roleHierarchy[role] ?? 0) < (roleHierarchy[input.requiredRole] ?? 0)) {
			throw new SessionAccessDeniedError(input.sessionId);
		}
	}
	return role;
}

/**
 * Grant a user access to a session with a specific role.
 * Session creator always has owner access (not stored in ACL).
 */
export async function grantSessionAccess(input: {
	sessionId: string;
	organizationId: string;
	targetUserId: string;
	role: string;
	grantedBy: string;
}): Promise<void> {
	const session = await v1Db.findSessionById(input.sessionId, input.organizationId);
	if (!session) {
		throw new SessionNotFoundError(input.sessionId);
	}
	await v1Db.grantSessionAcl({
		sessionId: input.sessionId,
		userId: input.targetUserId,
		role: input.role,
		grantedBy: input.grantedBy,
	});
	// If session was private, promote to shared so ACL grants are honored
	if (session.visibility === "private") {
		await v1Db.updateSessionVisibility(input.sessionId, "shared");
	}
}

// ============================================
// K3: Mark session viewed
// ============================================

export async function markSessionViewed(input: {
	sessionId: string;
	userId: string;
}): Promise<void> {
	await v1Db.upsertSessionUserState({
		sessionId: input.sessionId,
		userId: input.userId,
		lastViewedAt: new Date(),
	});
}

// ============================================
// K4: Operator status projection
// ============================================

export async function updateSessionOperatorStatus(input: {
	sessionId: string;
	organizationId: string;
	operatorStatus: string;
}): Promise<void> {
	await v1Db.updateOperatorStatus(input.sessionId, input.operatorStatus);
}

// ============================================
// K5: Session lifecycle events
// ============================================

export async function recordSessionEvent(input: {
	sessionId: string;
	eventType: string;
	actorUserId?: string | null;
	payloadJson?: unknown;
}): Promise<void> {
	await v1Db.createSessionEvent({
		sessionId: input.sessionId,
		eventType: input.eventType,
		actorUserId: input.actorUserId,
		payloadJson: input.payloadJson,
	});
}

export async function getSessionEvents(sessionId: string) {
	return v1Db.listSessionEvents(sessionId);
}

// ============================================
// K6: Archive and delete
// ============================================

export async function archiveSession(input: {
	sessionId: string;
	organizationId: string;
	userId: string;
}): Promise<void> {
	const session = await v1Db.findSessionById(input.sessionId, input.organizationId);
	if (!session) {
		throw new SessionNotFoundError(input.sessionId);
	}
	await v1Db.archiveSession(input.sessionId, input.userId);
}

export async function unarchiveSession(input: {
	sessionId: string;
	organizationId: string;
}): Promise<void> {
	const session = await v1Db.findSessionById(input.sessionId, input.organizationId);
	if (!session) {
		throw new SessionNotFoundError(input.sessionId);
	}
	await v1Db.unarchiveSession(input.sessionId);
}

export async function softDeleteSession(input: {
	sessionId: string;
	organizationId: string;
	userId: string;
}): Promise<void> {
	const session = await v1Db.findSessionById(input.sessionId, input.organizationId);
	if (!session) {
		throw new SessionNotFoundError(input.sessionId);
	}
	await v1Db.softDeleteSession(input.sessionId, input.userId);
}

export async function archiveSessionForUser(input: {
	sessionId: string;
	userId: string;
}): Promise<void> {
	await v1Db.archiveSessionForUser(input);
}

export async function unarchiveSessionForUser(input: {
	sessionId: string;
	userId: string;
}): Promise<void> {
	await v1Db.unarchiveSessionForUser(input);
}

// ============================================
// K7: Follow-up — send back to coworker
// ============================================

export async function sendBackToCoworker(input: {
	sessionId: string;
	organizationId: string;
	userId: string;
	workerId: string;
	workerRunId: string;
	messageType: string;
	payloadJson: unknown;
	dedupeKey?: string;
}): Promise<SendTaskFollowupResult> {
	const source = await v1Db.findSessionById(input.sessionId, input.organizationId);
	if (!source) {
		throw new SessionNotFoundError(input.sessionId);
	}
	if (source.kind !== "task") {
		throw new SessionKindError("task", source.kind);
	}
	if (
		!isTerminalSessionRuntimeStatus((source.runtimeStatus ?? "starting") as SessionRuntimeStatus)
	) {
		throw new SessionRuntimeStatusError(
			`Session ${input.sessionId} is not terminal — cannot send back to coworker`,
		);
	}
	if (!source.repoId || !source.repoBaselineId || !source.repoBaselineTargetId) {
		throw new SessionRuntimeStatusError(
			"Send-back-to-coworker requires repo + baseline linkage on the source session",
		);
	}

	const nextTask = await createUnifiedTaskSession({
		organizationId: input.organizationId,
		createdBy: input.userId,
		repoId: source.repoId,
		repoBaselineId: source.repoBaselineId,
		repoBaselineTargetId: source.repoBaselineTargetId,
		visibility: (source.visibility as "private" | "shared" | "org") ?? "private",
		continuedFromSessionId: source.id,
		workerId: input.workerId,
		workerRunId: input.workerRunId,
	});

	const nextSessionMessage = await v1Db.enqueueSessionMessage({
		sessionId: nextTask.id,
		direction: "user_to_task",
		messageType: input.messageType,
		payloadJson: input.payloadJson,
		dedupeKey: input.dedupeKey,
		senderUserId: input.userId,
	});

	return {
		deliverySessionId: nextTask.id,
		mode: "continuation",
		sessionMessage: nextSessionMessage,
	};
}
