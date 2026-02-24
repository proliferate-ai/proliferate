/**
 * Notifications DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import { and, eq, getDb, isNull, sessionNotificationSubscriptions } from "../db/client";
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
