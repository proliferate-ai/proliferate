/**
 * Sessions V1 DB operations.
 *
 * Focused helpers for V1 session-linked tables:
 * - session_capabilities
 * - session_skills
 * - session_messages
 * - session_user_state
 * - terminal session outcome persistence
 */

import {
	type InferSelectModel,
	and,
	asc,
	eq,
	getDb,
	inArray,
	isNotNull,
	isNull,
	lte,
	or,
	sql,
	sessionCapabilities,
	sessionMessages,
	sessionSkills,
	sessionUserState,
	sessions,
} from "@proliferate/services/db/client";
import type {
	SessionMessageDeliveryState,
	SessionMessageDirection,
} from "@proliferate/shared/contracts";

export type SessionRow = InferSelectModel<typeof sessions>;
export type SessionCapabilityRow = InferSelectModel<typeof sessionCapabilities>;
export type SessionSkillRow = InferSelectModel<typeof sessionSkills>;
export type SessionMessageRow = InferSelectModel<typeof sessionMessages>;
export type SessionUserStateRow = InferSelectModel<typeof sessionUserState>;

export interface CreateTaskSessionInput {
	id?: string;
	organizationId: string;
	createdBy: string;
	repoId: string;
	repoBaselineId: string;
	repoBaselineTargetId: string;
	workerId?: string | null;
	workerRunId?: string | null;
	parentSessionId?: string | null;
	continuedFromSessionId?: string | null;
	rerunOfSessionId?: string | null;
	configurationId?: string | null;
	visibility?: "private" | "shared" | "org";
	initialPrompt?: string | null;
	title?: string | null;
}

export async function createTaskSession(input: CreateTaskSessionInput): Promise<SessionRow> {
	if (!input.repoId || !input.repoBaselineId || !input.repoBaselineTargetId) {
		throw new Error("Task session requires repo + baseline + baseline target linkage");
	}

	const db = getDb();
	const [row] = await db
		.insert(sessions)
		.values({
			id: input.id,
			organizationId: input.organizationId,
			createdBy: input.createdBy,
			sessionType: "coding",
			kind: "task",
			status: "starting",
			runtimeStatus: "starting",
			operatorStatus: "active",
			visibility: input.visibility ?? "private",
			repoId: input.repoId,
			repoBaselineId: input.repoBaselineId,
			repoBaselineTargetId: input.repoBaselineTargetId,
			workerId: input.workerId ?? null,
			workerRunId: input.workerRunId ?? null,
			parentSessionId: input.parentSessionId ?? null,
			continuedFromSessionId: input.continuedFromSessionId ?? null,
			rerunOfSessionId: input.rerunOfSessionId ?? null,
			configurationId: input.configurationId ?? null,
			initialPrompt: input.initialPrompt ?? null,
			title: input.title ?? null,
		})
		.returning();

	return row;
}

export async function findSessionById(
	sessionId: string,
	organizationId: string,
): Promise<SessionRow | undefined> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(sessions)
		.where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, organizationId)))
		.limit(1);
	return row;
}

export async function findLatestTerminalFollowupSession(input: {
	organizationId: string;
	sourceSessionId: string;
	mode: "continuation" | "rerun";
}): Promise<SessionRow | undefined> {
	const db = getDb();
	return db.query.sessions.findFirst({
		where: and(
			eq(sessions.organizationId, input.organizationId),
			eq(sessions.kind, "task"),
			isNull(sessions.workerId),
			isNull(sessions.workerRunId),
			input.mode === "continuation"
				? eq(sessions.continuedFromSessionId, input.sourceSessionId)
				: eq(sessions.rerunOfSessionId, input.sourceSessionId),
		),
		orderBy: (table, { desc }) => [desc(table.startedAt), desc(table.id)],
	});
}

export interface UpsertSessionCapabilityInput {
	sessionId: string;
	capabilityKey: string;
	mode: "allow" | "require_approval" | "deny";
	scope?: unknown;
	origin?: string;
}

export async function upsertSessionCapability(
	input: UpsertSessionCapabilityInput,
): Promise<SessionCapabilityRow> {
	const db = getDb();
	const now = new Date();

	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(sessionCapabilities)
			.values({
				sessionId: input.sessionId,
				capabilityKey: input.capabilityKey,
				mode: input.mode,
				scope: input.scope ?? null,
				origin: input.origin ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [sessionCapabilities.sessionId, sessionCapabilities.capabilityKey],
				set: {
					mode: input.mode,
					...(input.scope !== undefined && { scope: input.scope }),
					...(input.origin !== undefined && { origin: input.origin }),
					updatedAt: now,
				},
			})
			.returning();

		await tx
			.update(sessions)
			.set({ capabilitiesVersion: sql`${sessions.capabilitiesVersion} + 1` })
			.where(eq(sessions.id, input.sessionId));

		return row;
	});
}

export interface UpsertSessionSkillInput {
	sessionId: string;
	skillKey: string;
	configJson?: unknown;
	origin?: string;
}

export async function upsertSessionSkill(input: UpsertSessionSkillInput): Promise<SessionSkillRow> {
	const db = getDb();
	const now = new Date();

	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(sessionSkills)
			.values({
				sessionId: input.sessionId,
				skillKey: input.skillKey,
				configJson: input.configJson ?? null,
				origin: input.origin ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [sessionSkills.sessionId, sessionSkills.skillKey],
				set: {
					configJson: input.configJson ?? null,
					origin: input.origin ?? null,
					updatedAt: now,
				},
			})
			.returning();

		await tx
			.update(sessions)
			.set({ capabilitiesVersion: sql`${sessions.capabilitiesVersion} + 1` })
			.where(eq(sessions.id, input.sessionId));

		return row;
	});
}

export interface EnqueueSessionMessageInput {
	sessionId: string;
	direction: SessionMessageDirection;
	messageType: string;
	payloadJson: unknown;
	dedupeKey?: string;
	deliverAfter?: Date;
	senderUserId?: string;
	senderSessionId?: string;
}

export interface FindTerminalFollowupMessageByDedupeInput {
	organizationId: string;
	sourceSessionId: string;
	dedupeKey: string;
	mode: "continuation" | "rerun";
}

export async function enqueueSessionMessage(
	input: EnqueueSessionMessageInput,
): Promise<SessionMessageRow> {
	const db = getDb();
	const values = {
		sessionId: input.sessionId,
		direction: input.direction,
		messageType: input.messageType,
		payloadJson: input.payloadJson,
		dedupeKey: input.dedupeKey ?? null,
		deliverAfter: input.deliverAfter ?? null,
		senderUserId: input.senderUserId ?? null,
		senderSessionId: input.senderSessionId ?? null,
	};

	const rows = input.dedupeKey
		? await db
				.insert(sessionMessages)
				.values(values)
				.onConflictDoNothing({
					target: [sessionMessages.sessionId, sessionMessages.dedupeKey],
					targetWhere: isNotNull(sessionMessages.dedupeKey),
				})
				.returning()
		: await db.insert(sessionMessages).values(values).returning();

	const inserted = rows[0];
	if (inserted) {
		return inserted;
	}

	if (!input.dedupeKey) {
		throw new Error("Failed to enqueue session message");
	}

	const [existing] = await db
		.select()
		.from(sessionMessages)
		.where(
			and(
				eq(sessionMessages.sessionId, input.sessionId),
				eq(sessionMessages.dedupeKey, input.dedupeKey),
			),
		)
		.limit(1);

	if (!existing) {
		throw new Error("Failed to resolve deduped session message");
	}

	return existing;
}

export async function findTerminalFollowupMessageByDedupe(
	input: FindTerminalFollowupMessageByDedupeInput,
): Promise<{ deliverySessionId: string; sessionMessage: SessionMessageRow } | undefined> {
	const db = getDb();
	const lineageFilter =
		input.mode === "continuation"
			? eq(sessions.continuedFromSessionId, input.sourceSessionId)
			: eq(sessions.rerunOfSessionId, input.sourceSessionId);

	const [row] = await db
		.select({
			deliverySessionId: sessions.id,
			sessionMessage: sessionMessages,
		})
		.from(sessionMessages)
		.innerJoin(sessions, eq(sessionMessages.sessionId, sessions.id))
		.where(
			and(
				eq(sessions.organizationId, input.organizationId),
				eq(sessionMessages.dedupeKey, input.dedupeKey),
				eq(sessionMessages.direction, "user_to_task"),
				lineageFilter,
			),
		)
		.orderBy(asc(sessionMessages.queuedAt), asc(sessionMessages.id))
		.limit(1);

	if (!row) {
		return undefined;
	}

	return row;
}

export async function listQueuedSessionMessages(sessionId: string): Promise<SessionMessageRow[]> {
	const db = getDb();
	return db
		.select()
		.from(sessionMessages)
		.where(
			and(eq(sessionMessages.sessionId, sessionId), eq(sessionMessages.deliveryState, "queued")),
		)
		.orderBy(sessionMessages.queuedAt);
}

export async function listDeliverableSessionMessages(
	sessionId: string,
	now = new Date(),
): Promise<SessionMessageRow[]> {
	const db = getDb();
	return db
		.select()
		.from(sessionMessages)
		.where(
			and(
				eq(sessionMessages.sessionId, sessionId),
				eq(sessionMessages.deliveryState, "queued"),
				or(isNull(sessionMessages.deliverAfter), lte(sessionMessages.deliverAfter, now)),
			),
		)
		.orderBy(asc(sessionMessages.queuedAt), asc(sessionMessages.id));
}

/**
 * Atomically claims queued + deliverable messages for delivery.
 *
 * Delivery order is deterministic: queuedAt ASC, id ASC.
 */
export async function claimDeliverableSessionMessages(
	sessionId: string,
	limit = 50,
): Promise<SessionMessageRow[]> {
	const db = getDb();
	const result = await db.execute<SessionMessageRow>(sql`
		WITH selected AS (
			SELECT ${sessionMessages.id}, ${sessionMessages.queuedAt}
			FROM ${sessionMessages}
			WHERE ${sessionMessages.sessionId} = ${sessionId}
			  AND ${sessionMessages.deliveryState} = 'queued'
			  AND (${sessionMessages.deliverAfter} IS NULL OR ${sessionMessages.deliverAfter} <= now())
			ORDER BY ${sessionMessages.queuedAt} ASC, ${sessionMessages.id} ASC
			LIMIT ${limit}
			FOR UPDATE SKIP LOCKED
		), updated AS (
			UPDATE ${sessionMessages}
			SET "delivery_state" = 'delivered',
				"delivered_at" = now()
			WHERE ${sessionMessages.id} IN (SELECT id FROM selected)
			RETURNING
				${sessionMessages.id} as "id",
				${sessionMessages.sessionId} as "sessionId",
				${sessionMessages.direction} as "direction",
				${sessionMessages.messageType} as "messageType",
				${sessionMessages.payloadJson} as "payloadJson",
				${sessionMessages.deliveryState} as "deliveryState",
				${sessionMessages.dedupeKey} as "dedupeKey",
				${sessionMessages.queuedAt} as "queuedAt",
				${sessionMessages.deliverAfter} as "deliverAfter",
				${sessionMessages.deliveredAt} as "deliveredAt",
				${sessionMessages.consumedAt} as "consumedAt",
				${sessionMessages.failedAt} as "failedAt",
				${sessionMessages.failureReason} as "failureReason",
				${sessionMessages.senderUserId} as "senderUserId",
				${sessionMessages.senderSessionId} as "senderSessionId"
		)
		SELECT updated.*
		FROM updated
		INNER JOIN selected ON selected.id = updated.id
		ORDER BY selected.queued_at ASC, selected.id ASC
		`);
	const rows = Array.isArray(result)
		? result
		: ((result as { rows?: SessionMessageRow[] }).rows ?? []);
	return rows as SessionMessageRow[];
}

export async function updateSessionMessageDeliveryState(
	id: string,
	deliveryState: SessionMessageDeliveryState,
	fields?: {
		deliveredAt?: Date | null;
		consumedAt?: Date | null;
		failedAt?: Date | null;
		failureReason?: string | null;
	},
): Promise<SessionMessageRow | undefined> {
	const db = getDb();
	const [row] = await db
		.update(sessionMessages)
		.set({
			deliveryState,
			deliveredAt: fields?.deliveredAt,
			consumedAt: fields?.consumedAt,
			failedAt: fields?.failedAt,
			failureReason: fields?.failureReason,
		})
		.where(eq(sessionMessages.id, id))
		.returning();
	return row;
}

export async function transitionSessionMessageDeliveryState(input: {
	id: string;
	fromStates: SessionMessageDeliveryState[];
	toState: SessionMessageDeliveryState;
	fields?: {
		deliveredAt?: Date | null;
		consumedAt?: Date | null;
		failedAt?: Date | null;
		failureReason?: string | null;
	};
}): Promise<SessionMessageRow | undefined> {
	if (input.fromStates.length === 0) {
		throw new Error("fromStates must include at least one state");
	}

	const db = getDb();
	const [row] = await db
		.update(sessionMessages)
		.set({
			deliveryState: input.toState,
			deliveredAt: input.fields?.deliveredAt,
			consumedAt: input.fields?.consumedAt,
			failedAt: input.fields?.failedAt,
			failureReason: input.fields?.failureReason,
		})
		.where(
			and(
				eq(sessionMessages.id, input.id),
				inArray(sessionMessages.deliveryState, input.fromStates),
			),
		)
		.returning();
	return row;
}

export interface UpsertSessionUserStateInput {
	sessionId: string;
	userId: string;
	lastViewedAt?: Date | null;
	archivedAt?: Date | null;
}

export async function upsertSessionUserState(
	input: UpsertSessionUserStateInput,
): Promise<SessionUserStateRow> {
	const db = getDb();
	const now = new Date();
	const [row] = await db
		.insert(sessionUserState)
		.values({
			sessionId: input.sessionId,
			userId: input.userId,
			lastViewedAt: input.lastViewedAt ?? null,
			archivedAt: input.archivedAt ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [sessionUserState.sessionId, sessionUserState.userId],
			set: {
				...(input.lastViewedAt !== undefined && { lastViewedAt: input.lastViewedAt }),
				...(input.archivedAt !== undefined && { archivedAt: input.archivedAt }),
				updatedAt: now,
			},
		})
		.returning();
	return row;
}

export interface PersistSessionOutcomeInput {
	sessionId: string;
	outcomeJson: unknown;
	outcomeVersion?: number;
}

export async function persistSessionOutcome(
	input: PersistSessionOutcomeInput,
): Promise<SessionRow | undefined> {
	const db = getDb();
	const now = new Date();
	const [row] = await db
		.update(sessions)
		.set({
			outcomeJson: input.outcomeJson,
			outcomeVersion: input.outcomeVersion ?? 1,
			outcomePersistedAt: now,
		})
		.where(eq(sessions.id, input.sessionId))
		.returning();
	return row;
}

export async function getSessionOutcome(sessionId: string): Promise<{
	outcomeJson: unknown;
	outcomeVersion: number | null;
	outcomePersistedAt: Date | null;
} | null> {
	const db = getDb();
	const [row] = await db
		.select({
			outcomeJson: sessions.outcomeJson,
			outcomeVersion: sessions.outcomeVersion,
			outcomePersistedAt: sessions.outcomePersistedAt,
		})
		.from(sessions)
		.where(eq(sessions.id, sessionId))
		.limit(1);

	if (!row) {
		return null;
	}

	return row;
}
