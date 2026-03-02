/**
 * Notifications oRPC router.
 *
 * Provides in-app notification endpoints: list, unread count,
 * mark read, dismiss, and bulk operations.
 */

import { notifications } from "@proliferate/services";
import { NotificationSchema } from "@proliferate/shared/contracts";
import { z } from "zod";
import { orgProcedure } from "./middleware";

const NotificationFilterSchema = z.object({
	status: z.string().optional(),
	category: z.string().optional(),
	workerId: z.string().uuid().optional(),
	before: z.string().datetime().optional(),
	limit: z.number().int().min(1).max(100).optional(),
});

export const notificationsRouter = {
	/**
	 * List notifications for the current user.
	 */
	list: orgProcedure
		.input(NotificationFilterSchema)
		.output(z.object({ notifications: z.array(NotificationSchema) }))
		.handler(async ({ input, context }) => {
			const rows = await notifications.getNotifications({
				userId: context.user.id,
				organizationId: context.orgId,
				status: input.status,
				category: input.category,
				workerId: input.workerId,
				before: input.before ? new Date(input.before) : undefined,
				limit: input.limit,
			});

			return {
				notifications: rows.map(mapNotificationRow),
			};
		}),

	/**
	 * Get unread notification count for badge display.
	 */
	unreadCount: orgProcedure.output(z.object({ count: z.number() })).handler(async ({ context }) => {
		const count = await notifications.getUnreadCount(context.user.id, context.orgId);
		return { count };
	}),

	/**
	 * Mark a single notification as read.
	 */
	markRead: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			await notifications.markRead(input.id);
			return { success: true };
		}),

	/**
	 * Dismiss a single notification.
	 */
	dismiss: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			await notifications.markDismissed(input.id);
			return { success: true };
		}),

	/**
	 * Bulk mark notifications as read.
	 */
	bulkMarkRead: orgProcedure
		.input(z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }))
		.output(z.object({ updated: z.number() }))
		.handler(async ({ input, context }) => {
			const updated = await notifications.bulkMarkRead(input.ids, context.user.id);
			return { updated };
		}),

	/**
	 * Bulk dismiss notifications.
	 */
	bulkDismiss: orgProcedure
		.input(z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }))
		.output(z.object({ updated: z.number() }))
		.handler(async ({ input, context }) => {
			const updated = await notifications.bulkDismiss(input.ids, context.user.id);
			return { updated };
		}),

	/**
	 * Update notification preferences.
	 */
	updatePreferences: orgProcedure
		.input(
			z.object({
				workerId: z.string().uuid().nullable().optional(),
				channelOverrides: z.record(z.array(z.string())).optional(),
				mutedCategories: z.array(z.string()).optional(),
				digestCadence: z.enum(["immediate", "5min", "15min", "1hr"]).optional(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			await notifications.updatePreferences({
				organizationId: context.orgId,
				userId: context.user.id,
				workerId: input.workerId,
				channelOverrides: input.channelOverrides,
				mutedCategories: input.mutedCategories,
				digestCadence: input.digestCadence,
			});
			return { success: true };
		}),

	/**
	 * Get notification preferences.
	 */
	getPreferences: orgProcedure
		.input(z.object({ workerId: z.string().uuid().nullable().optional() }))
		.output(
			z.object({
				preferences: z
					.object({
						channelOverrides: z.record(z.array(z.string())),
						mutedCategories: z.array(z.string()),
						digestCadence: z.string(),
					})
					.nullable(),
			}),
		)
		.handler(async ({ input, context }) => {
			const pref = await notifications.getPreferences(
				context.user.id,
				context.orgId,
				input.workerId,
			);
			if (!pref) return { preferences: null };
			return {
				preferences: {
					channelOverrides: (pref.channelOverrides ?? {}) as Record<string, string[]>,
					mutedCategories: (pref.mutedCategories ?? []) as string[],
					digestCadence: pref.digestCadence ?? "immediate",
				},
			};
		}),
};

function mapNotificationRow(row: notifications.NotificationRow) {
	const payload = row.payload as Record<string, unknown>;
	return {
		id: row.id,
		organizationId: row.organizationId,
		userId: row.userId,
		workerId: row.workerId ?? null,
		sessionId: row.sessionId ?? null,
		runId: row.runId ?? null,
		category: row.category as
			| "approval_required"
			| "run_started"
			| "run_blocked"
			| "run_failed"
			| "run_completed"
			| "agent_health_degraded",
		channel: row.channel as "in_app" | "slack",
		status: row.status as "pending" | "delivered" | "read" | "dismissed" | "failed",
		payload: {
			title: (payload.title as string) ?? "",
			summary: (payload.summary as string) ?? "",
			deepLinks: (payload.deepLinks as Array<{ label: string; url: string }>) ?? [],
			severity: ((payload.severity as string) ?? "normal") as "urgent" | "high" | "normal",
			actionContext: (payload.actionContext as Record<string, unknown>) ?? undefined,
		},
		idempotencyKey: row.idempotencyKey ?? null,
		createdAt: row.createdAt.toISOString(),
		deliveredAt: row.deliveredAt?.toISOString() ?? null,
		readAt: row.readAt?.toISOString() ?? null,
		dismissedAt: row.dismissedAt?.toISOString() ?? null,
	};
}
