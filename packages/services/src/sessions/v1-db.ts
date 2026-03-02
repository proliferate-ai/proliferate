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
	eq,
	getDb,
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

export type SessionCapabilityRow = InferSelectModel<typeof sessionCapabilities>;
export type SessionSkillRow = InferSelectModel<typeof sessionSkills>;
export type SessionMessageRow = InferSelectModel<typeof sessionMessages>;
export type SessionUserStateRow = InferSelectModel<typeof sessionUserState>;

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

export async function enqueueSessionMessage(
	input: EnqueueSessionMessageInput,
): Promise<SessionMessageRow> {
	const db = getDb();
	const [row] = await db
		.insert(sessionMessages)
		.values({
			sessionId: input.sessionId,
			direction: input.direction,
			messageType: input.messageType,
			payloadJson: input.payloadJson,
			dedupeKey: input.dedupeKey ?? null,
			deliverAfter: input.deliverAfter ?? null,
			senderUserId: input.senderUserId ?? null,
			senderSessionId: input.senderSessionId ?? null,
		})
		.returning();
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

export async function persistSessionOutcome(input: PersistSessionOutcomeInput): Promise<void> {
	const db = getDb();
	const now = new Date();
	await db
		.update(sessions)
		.set({
			outcomeJson: input.outcomeJson,
			outcomeVersion: input.outcomeVersion ?? 1,
			outcomePersistedAt: now,
		})
		.where(eq(sessions.id, input.sessionId));
}
