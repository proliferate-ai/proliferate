import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { integrations } from "./integrations";
import { sessions } from "./sessions";

export const actionInvocations = pgTable(
	"action_invocations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		organizationId: text("organization_id").notNull(),
		integrationId: uuid("integration_id"),
		integration: text("integration").notNull(),
		action: text("action").notNull(),
		riskLevel: text("risk_level").notNull(),
		mode: text("mode"),
		modeSource: text("mode_source"),
		params: jsonb("params"),
		status: text("status").default("pending").notNull(),
		result: jsonb("result"),
		error: text("error"),
		deniedReason: text("denied_reason"),
		durationMs: integer("duration_ms"),
		approvedBy: text("approved_by"),
		approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
		completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_action_invocations_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_action_invocations_org_created").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.createdAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("idx_action_invocations_status_expires").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
			table.expiresAt.asc().nullsLast().op("timestamptz_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "action_invocations_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.integrationId],
			foreignColumns: [integrations.id],
			name: "action_invocations_integration_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "action_invocations_session_id_fkey",
		}).onDelete("cascade"),
		check(
			"action_invocations_status_check",
			sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text, 'expired'::text, 'executing'::text, 'completed'::text, 'failed'::text])`,
		),
	],
);

export const actionInvocationEvents = pgTable(
	"action_invocation_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		actionInvocationId: uuid("action_invocation_id").notNull(),
		eventType: text("event_type").notNull(),
		actorUserId: text("actor_user_id"),
		payloadJson: jsonb("payload_json"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_action_invocation_events_invocation").using(
			"btree",
			table.actionInvocationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_action_invocation_events_type").using(
			"btree",
			table.eventType.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.actionInvocationId],
			foreignColumns: [actionInvocations.id],
			name: "action_invocation_events_action_invocation_id_fkey",
		}).onDelete("cascade"),
	],
);

export const resumeIntents = pgTable(
	"resume_intents",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		originSessionId: uuid("origin_session_id").notNull(),
		invocationId: uuid("invocation_id").notNull(),
		status: text("status").notNull().default("queued"),
		payloadJson: jsonb("payload_json"),
		errorMessage: text("error_message"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
		resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
	},
	(table) => [
		index("idx_resume_intents_origin_session").using(
			"btree",
			table.originSessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_resume_intents_invocation").using(
			"btree",
			table.invocationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_resume_intents_status").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
		),
		uniqueIndex("uq_resume_intents_one_active")
			.on(table.originSessionId, table.invocationId)
			.where(sql`status NOT IN ('satisfied', 'continued', 'resume_failed')`),
		check(
			"resume_intents_status_check",
			sql`status = ANY (ARRAY['queued'::text, 'claimed'::text, 'resuming'::text, 'satisfied'::text, 'continued'::text, 'resume_failed'::text])`,
		),
		foreignKey({
			columns: [table.originSessionId],
			foreignColumns: [sessions.id],
			name: "resume_intents_origin_session_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.invocationId],
			foreignColumns: [actionInvocations.id],
			name: "resume_intents_invocation_id_fkey",
		}).onDelete("cascade"),
	],
);

export const userActionPreferences = pgTable(
	"user_action_preferences",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		organizationId: text("organization_id").notNull(),
		sourceId: text("source_id").notNull(),
		actionId: text("action_id"),
		enabled: boolean().notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_user_action_prefs_user_org").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "user_action_preferences_user_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "user_action_preferences_organization_id_fkey",
		}).onDelete("cascade"),
		unique("user_action_prefs_user_org_source_action_key")
			.on(table.userId, table.organizationId, table.sourceId, table.actionId)
			.nullsNotDistinct(),
	],
);

export const actionInvocationsRelations = relations(actionInvocations, ({ one }) => ({
	organization: one(organization, {
		fields: [actionInvocations.organizationId],
		references: [organization.id],
	}),
	integration: one(integrations, {
		fields: [actionInvocations.integrationId],
		references: [integrations.id],
	}),
	session: one(sessions, {
		fields: [actionInvocations.sessionId],
		references: [sessions.id],
	}),
}));

export const actionInvocationEventsRelations = relations(actionInvocationEvents, ({ one }) => ({
	actionInvocation: one(actionInvocations, {
		fields: [actionInvocationEvents.actionInvocationId],
		references: [actionInvocations.id],
	}),
}));

export const resumeIntentsRelations = relations(resumeIntents, ({ one }) => ({
	originSession: one(sessions, {
		fields: [resumeIntents.originSessionId],
		references: [sessions.id],
	}),
	actionInvocation: one(actionInvocations, {
		fields: [resumeIntents.invocationId],
		references: [actionInvocations.id],
	}),
}));

export const userActionPreferencesRelations = relations(userActionPreferences, ({ one }) => ({
	user: one(user, {
		fields: [userActionPreferences.userId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [userActionPreferences.organizationId],
		references: [organization.id],
	}),
}));
