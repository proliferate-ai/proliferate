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
