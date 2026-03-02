/**
 * Notifications schema
 *
 * Durable notification rows: in-app inbox + delivery tracking.
 */

import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

// ============================================
// Notifications
// ============================================

export const notifications = pgTable(
	"notifications",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		// Attribution (nullable — not all notifications relate to a worker/session/run)
		workerId: uuid("worker_id"),
		sessionId: uuid("session_id"),
		runId: uuid("run_id"),

		// Classification
		category: text("category").notNull(),
		channel: text("channel").notNull().default("in_app"),

		// Lifecycle
		status: text("status").notNull().default("pending"),

		// Structured payload (title, summary, deep links, severity, action context)
		payload: jsonb("payload").notNull(),

		// Idempotency — prevents duplicate notifications for the same event
		idempotencyKey: text("idempotency_key"),

		// Timestamps
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }),
		readAt: timestamp("read_at", { withTimezone: true }),
		dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
	},
	(table) => [
		index("idx_notifications_user_status").on(table.userId, table.status),
		index("idx_notifications_org_user").on(table.organizationId, table.userId, table.createdAt),
		index("idx_notifications_worker").on(table.workerId, table.createdAt),
		index("idx_notifications_session").on(table.sessionId),
		index("idx_notifications_idempotency").on(table.idempotencyKey),
		unique("uq_notifications_idempotency_key").on(table.idempotencyKey),
	],
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
	organization: one(organization, {
		fields: [notifications.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [notifications.userId],
		references: [user.id],
	}),
}));

// ============================================
// Notification Preferences
// ============================================

export const notificationPreferences = pgTable(
	"notification_preferences",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		// Optional scoping — null means org-wide default for this user
		workerId: uuid("worker_id"),

		// Per-category channel overrides: { "run_completed": ["in_app"], "approval_required": ["in_app", "slack"] }
		channelOverrides: jsonb("channel_overrides").default({}),

		// Muted categories (these won't generate notifications at all)
		mutedCategories: jsonb("muted_categories").default([]),

		// Digest cadence: "immediate" | "5min" | "15min" | "1hr"
		digestCadence: text("digest_cadence").default("immediate"),

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_notification_prefs_org_user").on(table.organizationId, table.userId),
		unique("uq_notification_prefs_user_worker").on(table.userId, table.workerId),
	],
);

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
	organization: one(organization, {
		fields: [notificationPreferences.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [notificationPreferences.userId],
		references: [user.id],
	}),
}));
