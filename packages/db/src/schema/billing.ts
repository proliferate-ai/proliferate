import { relations, sql } from "drizzle-orm";
import {
	foreignKey,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

export const billingEventKeys = pgTable("billing_event_keys", {
	idempotencyKey: text("idempotency_key").primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const billingEvents = pgTable(
	"billing_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		eventType: text("event_type").notNull(),
		quantity: numeric({ precision: 12, scale: 6 }).notNull(),
		credits: numeric({ precision: 12, scale: 6 }).notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		sessionIds: text("session_ids").array().default([""]),
		status: text().default("pending").notNull(),
		retryCount: integer("retry_count").default(0),
		nextRetryAt: timestamp("next_retry_at", { withTimezone: true, mode: "date" }).defaultNow(),
		lastError: text("last_error"),
		autumnResponse: jsonb("autumn_response"),
		metadata: jsonb().default({}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_billing_events_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.createdAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("idx_billing_events_outbox")
			.using(
				"btree",
				table.status.asc().nullsLast().op("text_ops"),
				table.nextRetryAt.asc().nullsLast().op("timestamptz_ops"),
			)
			.where(sql`(status = ANY (ARRAY['pending'::text, 'failed'::text]))`),
		index("idx_billing_events_session").using(
			"gin",
			table.sessionIds.asc().nullsLast().op("array_ops"),
		),
		index("idx_billing_events_type").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.eventType.asc().nullsLast().op("text_ops"),
			table.createdAt.asc().nullsLast().op("timestamptz_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "billing_events_organization_id_fkey",
		}).onDelete("cascade"),
		unique("billing_events_idempotency_key_key").on(table.idempotencyKey),
	],
);

export const llmSpendCursors = pgTable("llm_spend_cursors", {
	organizationId: text("organization_id")
		.primaryKey()
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	lastStartTime: timestamp("last_start_time", { withTimezone: true, mode: "date" }).notNull(),
	lastRequestId: text("last_request_id"),
	recordsProcessed: integer("records_processed").default(0).notNull(),
	syncedAt: timestamp("synced_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const billingReconciliations = pgTable(
	"billing_reconciliations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		type: text().notNull(),
		previousBalance: numeric("previous_balance", { precision: 12, scale: 6 }).notNull(),
		newBalance: numeric("new_balance", { precision: 12, scale: 6 }).notNull(),
		delta: numeric({ precision: 12, scale: 6 }).notNull(),
		reason: text().notNull(),
		performedBy: text("performed_by"),
		metadata: jsonb().default({}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_billing_reconciliations_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.createdAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("idx_billing_reconciliations_type").using(
			"btree",
			table.type.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "billing_reconciliations_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.performedBy],
			foreignColumns: [user.id],
			name: "billing_reconciliations_performed_by_fkey",
		}).onDelete("set null"),
	],
);

export const billingEventsRelations = relations(billingEvents, ({ one }) => ({
	organization: one(organization, {
		fields: [billingEvents.organizationId],
		references: [organization.id],
	}),
}));
