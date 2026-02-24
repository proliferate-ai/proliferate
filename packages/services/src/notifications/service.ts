/**
 * Notification service.
 *
 * Enqueues outbox items for run terminal transitions and manages
 * session notification subscriptions.
 */

import { enqueueOutbox } from "../outbox/service";
import * as notificationsDb from "./db";

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
	const row = await notificationsDb.upsertSubscription({
		sessionId: input.sessionId,
		userId: input.userId,
		slackInstallationId: input.slackInstallationId,
		destinationType: "dm_user",
		slackUserId: input.slackUserId ?? null,
		eventTypes: input.eventTypes ?? ["completed"],
	});

	return mapSubscription(row);
}

/**
 * Unsubscribe a user from session notifications.
 */
export async function unsubscribeFromSessionNotifications(
	sessionId: string,
	userId: string,
): Promise<boolean> {
	return notificationsDb.deleteSubscription(sessionId, userId);
}

/**
 * Get a user's subscription for a session.
 */
export async function getSessionNotificationSubscription(
	sessionId: string,
	userId: string,
): Promise<SessionNotificationSubscription | null> {
	const row = await notificationsDb.findSubscription(sessionId, userId);
	return row ? mapSubscription(row) : null;
}

/**
 * List all subscriptions for a session (for dispatch).
 */
export async function listSessionSubscriptions(
	sessionId: string,
): Promise<SessionNotificationSubscription[]> {
	const rows = await notificationsDb.findUnnotifiedSubscriptions(sessionId);
	return rows.map(mapSubscription);
}

/**
 * Mark a subscription as notified (idempotent delivery tracking).
 */
export async function markSubscriptionNotified(subscriptionId: string): Promise<void> {
	await notificationsDb.markNotified(subscriptionId);
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
