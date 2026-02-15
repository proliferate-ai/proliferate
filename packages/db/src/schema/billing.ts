/**
 * Billing schema
 */

import { relations } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

// ============================================
// Billing Events (Outbox Pattern)
// ============================================

export const billingEvents = pgTable(
	"billing_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Event classification
		eventType: text("event_type").notNull(), // 'compute' | 'llm'

		// Usage quantities (6 decimal places)
		quantity: numeric("quantity", { precision: 12, scale: 6 }).notNull(),
		credits: numeric("credits", { precision: 12, scale: 6 }).notNull(),

		// Idempotency
		idempotencyKey: text("idempotency_key").notNull().unique(),

		// Attribution
		sessionIds: text("session_ids").array().default([]),

		// Outbox state
		status: text("status").notNull().default("pending"), // 'pending', 'posted', 'failed'
		retryCount: integer("retry_count").default(0),
		nextRetryAt: timestamp("next_retry_at", { withTimezone: true }).defaultNow(),
		lastError: text("last_error"),
		autumnResponse: jsonb("autumn_response"),

		// Context
		metadata: jsonb("metadata").default({}),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("idx_billing_events_org").on(table.organizationId, table.createdAt),
		index("idx_billing_events_outbox").on(table.status, table.nextRetryAt),
		index("idx_billing_events_type").on(table.organizationId, table.eventType, table.createdAt),
	],
);

export const billingEventsRelations = relations(billingEvents, ({ one }) => ({
	organization: one(organization, {
		fields: [billingEvents.organizationId],
		references: [organization.id],
	}),
}));

// ============================================
// LLM Spend Cursors — Per-Org (Billing V2)
// ============================================

export const llmSpendCursors = pgTable("llm_spend_cursors", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	lastStartTime: timestamp("last_start_time", { withTimezone: true }).notNull(),
	lastRequestId: text("last_request_id"),
	recordsProcessed: integer("records_processed").default(0).notNull(),
	syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

// ============================================
// Billing Reconciliations (Billing V2)
// ============================================

export const billingReconciliations = pgTable(
	"billing_reconciliations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: text("type").notNull(), // 'shadow_sync' | 'manual_adjustment' | 'refund' | 'correction'
		previousBalance: numeric("previous_balance", { precision: 12, scale: 6 }).notNull(),
		newBalance: numeric("new_balance", { precision: 12, scale: 6 }).notNull(),
		delta: numeric("delta", { precision: 12, scale: 6 }).notNull(),
		reason: text("reason").notNull(),
		performedBy: text("performed_by").references(() => user.id, { onDelete: "set null" }),
		metadata: jsonb("metadata").default({}),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("idx_billing_reconciliations_org").on(table.organizationId, table.createdAt),
		index("idx_billing_reconciliations_type").on(table.type),
	],
);

export const billingReconciliationsRelations = relations(billingReconciliations, ({ one }) => ({
	organization: one(organization, {
		fields: [billingReconciliations.organizationId],
		references: [organization.id],
	}),
	performer: one(user, {
		fields: [billingReconciliations.performedBy],
		references: [user.id],
	}),
}));
