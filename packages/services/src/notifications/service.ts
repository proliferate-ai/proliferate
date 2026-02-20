/**
 * Notification service.
 *
 * Enqueues outbox items for run terminal transitions and manages
 * session notification subscriptions.
 */

import { and, eq, getDb, isNull, sessionNotificationSubscriptions } from "../db/client";
import { enqueueOutbox } from "../outbox/service";

const TERMINAL_STATUSES = ["succeeded", "failed", "timed_out", "needs_human"];

export async function enqueueRunNotification(
	organizationId: string,
	runId: string,
	status: string,
): Promise<void> {
	if (!TERMINAL_STATUSES.includes(status)) return;

	await enqueueOutbox({
		organizationId,
		kind: "notify_run_terminal",
		payload: { runId, status },
	});
}

// ============================================
// Session notification subscriptions
// ============================================

export interface SessionNotificationSubscription {
	id: string;
	sessionId: string;
	userId: string;
	slackInstallationId: string;
	destinationType: string;
	slackUserId: string | null;
	eventTypes: string[];
	createdAt: Date | null;
}

/**
 * Subscribe a user to session completion notifications.
 * Upserts — calling again for the same session+user updates the subscription.
 */
export async function subscribeToSessionNotifications(input: {
	sessionId: string;
	userId: string;
	slackInstallationId: string;
	slackUserId?: string | null;
	eventTypes?: string[];
}): Promise<SessionNotificationSubscription> {
	const db = getDb();
	const [row] = await db
		.insert(sessionNotificationSubscriptions)
		.values({
			sessionId: input.sessionId,
			userId: input.userId,
			slackInstallationId: input.slackInstallationId,
			destinationType: "dm_user",
			slackUserId: input.slackUserId ?? null,
			eventTypes: input.eventTypes ?? ["completed"],
		})
		.onConflictDoUpdate({
			target: [sessionNotificationSubscriptions.sessionId, sessionNotificationSubscriptions.userId],
			set: {
				slackInstallationId: input.slackInstallationId,
				slackUserId: input.slackUserId ?? null,
				eventTypes: input.eventTypes ?? ["completed"],
				updatedAt: new Date(),
			},
		})
		.returning();

	return mapSubscription(row);
}

/**
 * Unsubscribe a user from session notifications.
 */
export async function unsubscribeFromSessionNotifications(
	sessionId: string,
	userId: string,
): Promise<boolean> {
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

/**
 * Get a user's subscription for a session.
 */
export async function getSessionNotificationSubscription(
	sessionId: string,
	userId: string,
): Promise<SessionNotificationSubscription | null> {
	const db = getDb();
	const row = await db.query.sessionNotificationSubscriptions.findFirst({
		where: and(
			eq(sessionNotificationSubscriptions.sessionId, sessionId),
			eq(sessionNotificationSubscriptions.userId, userId),
		),
	});
	return row ? mapSubscription(row) : null;
}

/**
 * List all subscriptions for a session (for dispatch).
 */
export async function listSessionSubscriptions(
	sessionId: string,
): Promise<SessionNotificationSubscription[]> {
	const db = getDb();
	const rows = await db.query.sessionNotificationSubscriptions.findMany({
		where: and(
			eq(sessionNotificationSubscriptions.sessionId, sessionId),
			isNull(sessionNotificationSubscriptions.notifiedAt),
		),
	});
	return rows.map(mapSubscription);
}

/**
 * Mark a subscription as notified (idempotent delivery tracking).
 */
export async function markSubscriptionNotified(subscriptionId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessionNotificationSubscriptions)
		.set({ notifiedAt: new Date() })
		.where(eq(sessionNotificationSubscriptions.id, subscriptionId));
}

/**
 * Enqueue a session completion notification for dispatch.
 */
export async function enqueueSessionCompletionNotification(
	organizationId: string,
	sessionId: string,
): Promise<void> {
	await enqueueOutbox({
		organizationId,
		kind: "notify_session_complete",
		payload: { sessionId },
	});
}

function mapSubscription(row: {
	id: string;
	sessionId: string;
	userId: string;
	slackInstallationId: string;
	destinationType: string;
	slackUserId: string | null;
	eventTypes: unknown;
	createdAt: Date | null;
}): SessionNotificationSubscription {
	return {
		id: row.id,
		sessionId: row.sessionId,
		userId: row.userId,
		slackInstallationId: row.slackInstallationId,
		destinationType: row.destinationType,
		slackUserId: row.slackUserId,
		eventTypes: Array.isArray(row.eventTypes) ? row.eventTypes : ["completed"],
		createdAt: row.createdAt,
	};
}
