/**
 * Notifications DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import {
	and,
	desc,
	eq,
	getDb,
	gte,
	inArray,
	isNull,
	lt,
	ne,
	notificationPreferences,
	notifications,
	sessionNotificationSubscriptions,
	sql,
} from "../db/client";
import type { InferSelectModel } from "../db/client";

export type SessionNotificationSubscriptionRow = InferSelectModel<
	typeof sessionNotificationSubscriptions
>;

export async function upsertSubscription(input: {
	sessionId: string;
	userId: string;
	slackInstallationId: string;
	destinationType: string;
	slackUserId: string | null;
	eventTypes: string[];
}): Promise<SessionNotificationSubscriptionRow> {
	const db = getDb();
	const [row] = await db
		.insert(sessionNotificationSubscriptions)
		.values({
			sessionId: input.sessionId,
			userId: input.userId,
			slackInstallationId: input.slackInstallationId,
			destinationType: input.destinationType,
			slackUserId: input.slackUserId,
			eventTypes: input.eventTypes,
		})
		.onConflictDoUpdate({
			target: [sessionNotificationSubscriptions.sessionId, sessionNotificationSubscriptions.userId],
			set: {
				slackInstallationId: input.slackInstallationId,
				slackUserId: input.slackUserId,
				eventTypes: input.eventTypes,
				updatedAt: new Date(),
			},
		})
		.returning();

	return row;
}

export async function deleteSubscription(sessionId: string, userId: string): Promise<boolean> {
	const db = getDb();
	const result = await db
		.delete(sessionNotificationSubscriptions)
		.where(
			and(
				eq(sessionNotificationSubscriptions.sessionId, sessionId),
				eq(sessionNotificationSubscriptions.userId, userId),
			),
		)
		.returning({ id: sessionNotificationSubscriptions.id });
	return result.length > 0;
}

export async function findSubscription(
	sessionId: string,
	userId: string,
): Promise<SessionNotificationSubscriptionRow | null> {
	const db = getDb();
	const result = await db.query.sessionNotificationSubscriptions.findFirst({
		where: and(
			eq(sessionNotificationSubscriptions.sessionId, sessionId),
			eq(sessionNotificationSubscriptions.userId, userId),
		),
	});
	return result ?? null;
}

export async function findUnnotifiedSubscriptions(
	sessionId: string,
): Promise<SessionNotificationSubscriptionRow[]> {
	const db = getDb();
	return db.query.sessionNotificationSubscriptions.findMany({
		where: and(
			eq(sessionNotificationSubscriptions.sessionId, sessionId),
			isNull(sessionNotificationSubscriptions.notifiedAt),
		),
	});
}

export async function markNotified(subscriptionId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessionNotificationSubscriptions)
		.set({ notifiedAt: new Date() })
		.where(eq(sessionNotificationSubscriptions.id, subscriptionId));
}

// ============================================
// V1 Notifications (durable inbox rows)
// ============================================

export type NotificationRow = InferSelectModel<typeof notifications>;
export type NotificationPreferenceRow = InferSelectModel<typeof notificationPreferences>;

export interface InsertNotificationInput {
	organizationId: string;
	userId: string;
	workerId?: string | null;
	sessionId?: string | null;
	runId?: string | null;
	category: string;
	channel: string;
	payload: Record<string, unknown>;
	idempotencyKey?: string | null;
}

/**
 * Insert a notification row. Returns null if idempotency key already exists.
 */
export async function insertNotification(
	input: InsertNotificationInput,
): Promise<NotificationRow | null> {
	const db = getDb();
	const rows = await db
		.insert(notifications)
		.values({
			organizationId: input.organizationId,
			userId: input.userId,
			workerId: input.workerId ?? null,
			sessionId: input.sessionId ?? null,
			runId: input.runId ?? null,
			category: input.category,
			channel: input.channel,
			status: "pending",
			payload: input.payload,
			idempotencyKey: input.idempotencyKey ?? null,
		})
		.onConflictDoNothing({
			target: [notifications.idempotencyKey],
		})
		.returning();

	return rows[0] ?? null;
}

export async function findNotificationById(id: string): Promise<NotificationRow | null> {
	const db = getDb();
	const row = await db.query.notifications.findFirst({
		where: eq(notifications.id, id),
	});
	return row ?? null;
}

export interface ListNotificationsFilter {
	userId: string;
	organizationId: string;
	status?: string;
	category?: string;
	workerId?: string;
	before?: Date;
	limit?: number;
}

export async function listNotifications(
	filter: ListNotificationsFilter,
): Promise<NotificationRow[]> {
	const db = getDb();
	const conditions = [
		eq(notifications.userId, filter.userId),
		eq(notifications.organizationId, filter.organizationId),
	];

	if (filter.status) {
		conditions.push(eq(notifications.status, filter.status));
	}
	if (filter.category) {
		conditions.push(eq(notifications.category, filter.category));
	}
	if (filter.workerId) {
		conditions.push(eq(notifications.workerId, filter.workerId));
	}
	if (filter.before) {
		conditions.push(lt(notifications.createdAt, filter.before));
	}

	return db
		.select()
		.from(notifications)
		.where(and(...conditions))
		.orderBy(desc(notifications.createdAt))
		.limit(filter.limit ?? 50);
}

export async function countUnread(userId: string, organizationId: string): Promise<number> {
	const db = getDb();
	const result = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(notifications)
		.where(
			and(
				eq(notifications.userId, userId),
				eq(notifications.organizationId, organizationId),
				eq(notifications.channel, "in_app"),
				ne(notifications.status, "read"),
				ne(notifications.status, "dismissed"),
				ne(notifications.status, "failed"),
			),
		);
	return result[0]?.count ?? 0;
}

export async function markNotificationDelivered(id: string, channel: string): Promise<void> {
	const db = getDb();
	await db
		.update(notifications)
		.set({ status: "delivered", deliveredAt: new Date(), channel })
		.where(and(eq(notifications.id, id), eq(notifications.status, "pending")));
}

export async function markNotificationRead(id: string): Promise<void> {
	const db = getDb();
	await db
		.update(notifications)
		.set({ status: "read", readAt: new Date() })
		.where(eq(notifications.id, id));
}

export async function markNotificationDismissed(id: string): Promise<void> {
	const db = getDb();
	await db
		.update(notifications)
		.set({ status: "dismissed", dismissedAt: new Date() })
		.where(eq(notifications.id, id));
}

export async function markNotificationFailed(id: string): Promise<void> {
	const db = getDb();
	await db.update(notifications).set({ status: "failed" }).where(eq(notifications.id, id));
}

export async function bulkMarkNotificationsRead(ids: string[], userId: string): Promise<number> {
	if (ids.length === 0) return 0;
	const db = getDb();
	const now = new Date();
	const result = await db
		.update(notifications)
		.set({ status: "read", readAt: now })
		.where(and(inArray(notifications.id, ids), eq(notifications.userId, userId)))
		.returning({ id: notifications.id });
	return result.length;
}

export async function bulkDismissNotifications(ids: string[], userId: string): Promise<number> {
	if (ids.length === 0) return 0;
	const db = getDb();
	const now = new Date();
	const result = await db
		.update(notifications)
		.set({ status: "dismissed", dismissedAt: now })
		.where(and(inArray(notifications.id, ids), eq(notifications.userId, userId)))
		.returning({ id: notifications.id });
	return result.length;
}

/**
 * Count recent notifications for a worker within a time window.
 * Used by noise policy rate limiting.
 */
export async function countRecentByWorker(workerId: string, since: Date): Promise<number> {
	const db = getDb();
	const result = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(notifications)
		.where(and(eq(notifications.workerId, workerId), gte(notifications.createdAt, since)));
	return result[0]?.count ?? 0;
}

/**
 * Find a recent notification matching category + run to detect
 * duplicates within the suppression window (noise policy).
 */
export async function findRecentByRunAndCategory(
	runId: string,
	category: string,
	since: Date,
): Promise<NotificationRow | null> {
	const db = getDb();
	const row = await db.query.notifications.findFirst({
		where: and(
			eq(notifications.runId, runId),
			eq(notifications.category, category),
			gte(notifications.createdAt, since),
		),
	});
	return row ?? null;
}

// ============================================
// Notification Preferences
// ============================================

export async function findPreferences(
	userId: string,
	organizationId: string,
	workerId?: string | null,
): Promise<NotificationPreferenceRow | null> {
	const db = getDb();
	const conditions = [
		eq(notificationPreferences.userId, userId),
		eq(notificationPreferences.organizationId, organizationId),
	];
	if (workerId) {
		conditions.push(eq(notificationPreferences.workerId, workerId));
	} else {
		conditions.push(isNull(notificationPreferences.workerId));
	}
	const row = await db.query.notificationPreferences.findFirst({
		where: and(...conditions),
	});
	return row ?? null;
}

export async function upsertPreferences(input: {
	organizationId: string;
	userId: string;
	workerId?: string | null;
	channelOverrides?: Record<string, string[]>;
	mutedCategories?: string[];
	digestCadence?: string;
}): Promise<NotificationPreferenceRow> {
	const db = getDb();
	const [row] = await db
		.insert(notificationPreferences)
		.values({
			organizationId: input.organizationId,
			userId: input.userId,
			workerId: input.workerId ?? null,
			channelOverrides: input.channelOverrides ?? {},
			mutedCategories: input.mutedCategories ?? [],
			digestCadence: input.digestCadence ?? "immediate",
		})
		.onConflictDoUpdate({
			target: [notificationPreferences.userId, notificationPreferences.workerId],
			set: {
				channelOverrides: input.channelOverrides ?? {},
				mutedCategories: input.mutedCategories ?? [],
				digestCadence: input.digestCadence ?? "immediate",
				updatedAt: new Date(),
			},
		})
		.returning();
	return row;
}
