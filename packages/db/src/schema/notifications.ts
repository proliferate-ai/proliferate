import { relations, sql } from "drizzle-orm";
import {
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

export const notifications = pgTable(
	"notifications",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		userId: text("user_id").notNull(),
		workerId: uuid("worker_id"),
		sessionId: uuid("session_id"),
		runId: uuid("run_id"),
		category: text("category").notNull(),
		channel: text("channel").notNull().default("in_app"),
		status: text("status").notNull().default("pending"),
		payload: jsonb("payload").notNull(),
		idempotencyKey: text("idempotency_key"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
		readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
		dismissedAt: timestamp("dismissed_at", { withTimezone: true, mode: "date" }),
	},
	(table) => [
		index("idx_notifications_user_status").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
			table.status.asc().nullsLast().op("text_ops"),
		),
		index("idx_notifications_org_user").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.userId.asc().nullsLast().op("text_ops"),
			table.createdAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("idx_notifications_worker").on(table.workerId, table.createdAt),
		index("idx_notifications_session").on(table.sessionId),
		uniqueIndex("uq_notifications_idempotency_key")
			.on(table.idempotencyKey)
			.where(sql`idempotency_key IS NOT NULL`),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "notifications_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "notifications_user_id_fkey",
		}).onDelete("cascade"),
	],
);

export const notificationPreferences = pgTable(
	"notification_preferences",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		userId: text("user_id").notNull(),
		workerId: uuid("worker_id"),
		channelOverrides: jsonb("channel_overrides").default({}),
		mutedCategories: jsonb("muted_categories").default([]),
		digestCadence: text("digest_cadence").default("immediate"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_notification_prefs_org_user").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.userId.asc().nullsLast().op("text_ops"),
		),
		unique("uq_notification_prefs_user_worker").on(table.userId, table.workerId),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "notification_preferences_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "notification_preferences_user_id_fkey",
		}).onDelete("cascade"),
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
