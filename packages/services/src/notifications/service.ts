/**
 * Notification service.
 *
 * Enqueues outbox items for run terminal transitions, manages
 * session notification subscriptions, and handles V1 durable
 * notification lifecycle (create, deliver, read, dismiss).
 */

import {
	CATEGORY_ROUTING,
	IMMEDIATE_CATEGORIES,
	MAX_NOTIFICATIONS_PER_WORKER_PER_HOUR,
	type NotificationCategory,
	type NotificationChannel,
	type NotificationPayload,
	SUPPRESSION_WINDOW_MS,
} from "@proliferate/shared/contracts";
import { enqueueOutbox } from "../outbox/service";
import * as notificationsDb from "./db";
import type { NotificationRow } from "./db";

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

// ============================================
// V1 Notification lifecycle
// ============================================

export interface CreateNotificationInput {
	organizationId: string;
	userId: string;
	category: NotificationCategory;
	payload: NotificationPayload;
	workerId?: string | null;
	sessionId?: string | null;
	runId?: string | null;
	channel?: NotificationChannel;
	idempotencyKey?: string;
}

/**
 * Create a durable notification row.
 *
 * Applies noise policy:
 * - Suppression: deduplicates events for same run+category within window.
 * - Rate limiting: max N notifications per worker per hour.
 * - Immediate categories (approval_required) bypass suppression and rate limits.
 *
 * Returns the notification row, or null if suppressed/deduplicated.
 */
export async function createNotification(
	input: CreateNotificationInput,
): Promise<NotificationRow | null> {
	const routing = CATEGORY_ROUTING[input.category];
	const isImmediate = IMMEDIATE_CATEGORIES.includes(input.category);

	// Noise policy: suppression check (skip for immediate categories)
	if (!isImmediate && input.runId) {
		const suppressionCutoff = new Date(Date.now() - SUPPRESSION_WINDOW_MS);
		const existing = await notificationsDb.findRecentByRunAndCategory(
			input.runId,
			input.category,
			suppressionCutoff,
		);
		if (existing) return null;
	}

	// Noise policy: rate limiting per worker (skip for immediate categories)
	if (!isImmediate && input.workerId) {
		const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
		const recentCount = await notificationsDb.countRecentByWorker(input.workerId, oneHourAgo);
		if (recentCount >= MAX_NOTIFICATIONS_PER_WORKER_PER_HOUR) return null;
	}

	const channel = input.channel ?? routing?.defaultChannels[0] ?? "in_app";
	const idempotencyKey =
		input.idempotencyKey ??
		(input.runId ? `${input.category}:${input.runId}:${input.userId}` : undefined);

	return notificationsDb.insertNotification({
		organizationId: input.organizationId,
		userId: input.userId,
		workerId: input.workerId,
		sessionId: input.sessionId,
		runId: input.runId,
		category: input.category,
		channel,
		payload: input.payload as Record<string, unknown>,
		idempotencyKey,
	});
}

/**
 * Resolve delivery channels for a notification category.
 *
 * Precedence (per spec 09):
 * 1. Worker-level user preference override
 * 2. Org-level user preference
 * 3. Category default routing
 */
export async function resolveChannels(
	userId: string,
	organizationId: string,
	category: NotificationCategory,
	workerId?: string | null,
): Promise<NotificationChannel[]> {
	// Check worker-level override first
	if (workerId) {
		const workerPref = await notificationsDb.findPreferences(userId, organizationId, workerId);
		if (workerPref) {
			const overrides = workerPref.channelOverrides as Record<string, string[]> | null;
			const muted = workerPref.mutedCategories as string[] | null;
			if (muted?.includes(category)) return [];
			if (overrides?.[category]) return overrides[category] as NotificationChannel[];
		}
	}

	// Check org-level user preferences
	const orgPref = await notificationsDb.findPreferences(userId, organizationId);
	if (orgPref) {
		const overrides = orgPref.channelOverrides as Record<string, string[]> | null;
		const muted = orgPref.mutedCategories as string[] | null;
		if (muted?.includes(category)) return [];
		if (overrides?.[category]) return overrides[category] as NotificationChannel[];
	}

	// Fall back to category defaults
	return CATEGORY_ROUTING[category]?.defaultChannels ?? ["in_app"];
}

/**
 * Mark a notification as delivered on a specific channel.
 */
export async function markDelivered(id: string, channel: NotificationChannel): Promise<void> {
	await notificationsDb.markNotificationDelivered(id, channel);
}

/**
 * Mark a notification as read.
 */
export async function markRead(id: string): Promise<void> {
	await notificationsDb.markNotificationRead(id);
}

/**
 * Mark a notification as dismissed.
 */
export async function markDismissed(id: string): Promise<void> {
	await notificationsDb.markNotificationDismissed(id);
}

/**
 * Get notifications for a user with optional filters.
 */
export async function getNotifications(filter: {
	userId: string;
	organizationId: string;
	status?: string;
	category?: string;
	workerId?: string;
	before?: Date;
	limit?: number;
}): Promise<NotificationRow[]> {
	return notificationsDb.listNotifications(filter);
}

/**
 * Get unread notification count for badge display.
 */
export async function getUnreadCount(userId: string, organizationId: string): Promise<number> {
	return notificationsDb.countUnread(userId, organizationId);
}

/**
 * Bulk mark notifications as read.
 */
export async function bulkMarkRead(ids: string[], userId: string): Promise<number> {
	return notificationsDb.bulkMarkNotificationsRead(ids, userId);
}

/**
 * Bulk dismiss notifications.
 */
export async function bulkDismiss(ids: string[], userId: string): Promise<number> {
	return notificationsDb.bulkDismissNotifications(ids, userId);
}

/**
 * Enqueue an in-app notification creation via outbox.
 * Used by state-transition hooks that want async processing.
 */
export async function enqueueNotification(
	organizationId: string,
	input: {
		userId: string;
		category: NotificationCategory;
		payload: NotificationPayload;
		workerId?: string | null;
		sessionId?: string | null;
		runId?: string | null;
	},
): Promise<void> {
	await enqueueOutbox({
		organizationId,
		kind: "notify_v1",
		payload: {
			userId: input.userId,
			category: input.category,
			payload: input.payload,
			workerId: input.workerId ?? null,
			sessionId: input.sessionId ?? null,
			runId: input.runId ?? null,
		},
	});
}

/**
 * Update user notification preferences.
 */
export async function updatePreferences(input: {
	organizationId: string;
	userId: string;
	workerId?: string | null;
	channelOverrides?: Record<string, string[]>;
	mutedCategories?: string[];
	digestCadence?: string;
}): Promise<void> {
	await notificationsDb.upsertPreferences(input);
}

/**
 * Get user notification preferences.
 */
export async function getPreferences(
	userId: string,
	organizationId: string,
	workerId?: string | null,
): Promise<notificationsDb.NotificationPreferenceRow | null> {
	return notificationsDb.findPreferences(userId, organizationId, workerId);
}
