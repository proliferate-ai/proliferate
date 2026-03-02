/**
 * Notification contracts: categories, priorities, channels, and payload types.
 *
 * Source of truth for V1 notification event taxonomy per spec 09.
 */

import { z } from "zod";

// ============================================
// Categories
// ============================================

export const NotificationCategorySchema = z.enum([
	"approval_required",
	"run_started",
	"run_blocked",
	"run_failed",
	"run_completed",
	"agent_health_degraded",
]);

export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

// ============================================
// Priority
// ============================================

export const NotificationPrioritySchema = z.enum(["urgent", "high", "normal"]);

export type NotificationPriority = z.infer<typeof NotificationPrioritySchema>;

// ============================================
// Channel
// ============================================

export const NotificationChannelSchema = z.enum(["in_app", "slack"]);

export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

// ============================================
// Status
// ============================================

export const NotificationStatusSchema = z.enum([
	"pending",
	"delivered",
	"read",
	"dismissed",
	"failed",
]);

export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

// ============================================
// Payload
// ============================================

export const NotificationPayloadSchema = z.object({
	title: z.string(),
	summary: z.string(),
	deepLinks: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
	severity: NotificationPrioritySchema,
	actionContext: z.record(z.unknown()).optional(),
});

export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;

// ============================================
// Notification record (API response shape)
// ============================================

export const NotificationSchema = z.object({
	id: z.string().uuid(),
	organizationId: z.string(),
	userId: z.string(),
	workerId: z.string().uuid().nullable(),
	sessionId: z.string().uuid().nullable(),
	runId: z.string().uuid().nullable(),
	category: NotificationCategorySchema,
	channel: NotificationChannelSchema,
	status: NotificationStatusSchema,
	payload: NotificationPayloadSchema,
	idempotencyKey: z.string().nullable(),
	createdAt: z.string(),
	deliveredAt: z.string().nullable(),
	readAt: z.string().nullable(),
	dismissedAt: z.string().nullable(),
});

export type Notification = z.infer<typeof NotificationSchema>;

// ============================================
// Category routing config
// ============================================

export interface CategoryRouting {
	category: NotificationCategory;
	defaultChannels: NotificationChannel[];
	batchable: boolean;
	priority: NotificationPriority;
}

/**
 * Default routing rules per notification category.
 * Per spec 09: approval_required and escalation-type events are always
 * immediate (urgent) and never batchable.
 */
export const CATEGORY_ROUTING: Record<NotificationCategory, CategoryRouting> = {
	approval_required: {
		category: "approval_required",
		defaultChannels: ["in_app", "slack"],
		batchable: false,
		priority: "urgent",
	},
	run_started: {
		category: "run_started",
		defaultChannels: ["in_app"],
		batchable: true,
		priority: "normal",
	},
	run_blocked: {
		category: "run_blocked",
		defaultChannels: ["in_app", "slack"],
		batchable: false,
		priority: "high",
	},
	run_failed: {
		category: "run_failed",
		defaultChannels: ["in_app", "slack"],
		batchable: false,
		priority: "high",
	},
	run_completed: {
		category: "run_completed",
		defaultChannels: ["in_app"],
		batchable: true,
		priority: "normal",
	},
	agent_health_degraded: {
		category: "agent_health_degraded",
		defaultChannels: ["in_app", "slack"],
		batchable: false,
		priority: "high",
	},
};

// ============================================
// Noise policy constants
// ============================================

/** Default suppression window in milliseconds — coalesce events for same run. */
export const SUPPRESSION_WINDOW_MS = 60_000;

/** Default max notifications per worker per hour. */
export const MAX_NOTIFICATIONS_PER_WORKER_PER_HOUR = 30;

/** Categories that are always immediate and never batched or suppressed. */
export const IMMEDIATE_CATEGORIES: NotificationCategory[] = ["approval_required"];
