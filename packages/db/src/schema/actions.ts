/**
 * Actions schema — V1 action invocation events and resume intents.
 *
 * Tables: action_invocation_events, resume_intents
 *
 * Note: The existing `action_invocations` table lives in schema.ts (drizzle-kit pulled).
 * These new tables extend the actions subsystem for V1.
 */

import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
// Circular import: schema.ts re-exports this module.
import { actionInvocations } from "./schema";

// ============================================
// Action Invocation Events (V1)
// ============================================

export const actionInvocationEvents = pgTable(
	"action_invocation_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		actionInvocationId: uuid("action_invocation_id")
			.notNull()
			.references(() => actionInvocations.id, { onDelete: "cascade" }),

		// Event type (e.g. 'created', 'approved', 'denied', 'executing', 'completed', 'failed', 'expired')
		eventType: text("event_type").notNull(),

		// Actor
		actorUserId: text("actor_user_id"),

		// Payload
		payloadJson: jsonb("payload_json"),

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_action_invocation_events_invocation").on(table.actionInvocationId),
		index("idx_action_invocation_events_type").on(table.eventType),
	],
);

export const actionInvocationEventsRelations = relations(actionInvocationEvents, ({ one }) => ({
	actionInvocation: one(actionInvocations, {
		fields: [actionInvocationEvents.actionInvocationId],
		references: [actionInvocations.id],
	}),
}));

// ============================================
// Resume Intents (V1)
// ============================================

export const resumeIntents = pgTable(
	"resume_intents",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		// Origin session that needs to resume after approval
		originSessionId: uuid("origin_session_id").notNull(),

		// The action invocation that triggered the resume need
		invocationId: uuid("invocation_id")
			.notNull()
			.references(() => actionInvocations.id, { onDelete: "cascade" }),

		// Status: queued | claimed | resuming | satisfied | continued | resume_failed
		status: text("status").notNull().default("queued"),

		// Resume context
		payloadJson: jsonb("payload_json"),

		// Error info
		errorMessage: text("error_message"),

		// Timestamps
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
	},
	(table) => [
		index("idx_resume_intents_origin_session").on(table.originSessionId),
		index("idx_resume_intents_invocation").on(table.invocationId),
		index("idx_resume_intents_status").on(table.status),

		// One active resume intent per (origin_session_id, invocation_id)
		uniqueIndex("uq_resume_intents_one_active")
			.on(table.originSessionId, table.invocationId)
			.where(sql`status NOT IN ('satisfied', 'continued', 'resume_failed')`),
		check(
			"resume_intents_status_check",
			sql`status = ANY (ARRAY['queued'::text, 'claimed'::text, 'resuming'::text, 'satisfied'::text, 'continued'::text, 'resume_failed'::text])`,
		),
	],
);

export const resumeIntentsRelations = relations(resumeIntents, ({ one }) => ({
	actionInvocation: one(actionInvocations, {
		fields: [resumeIntents.invocationId],
		references: [actionInvocations.id],
	}),
}));
