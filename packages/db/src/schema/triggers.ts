import { relations, sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
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
import { automationRuns, automations } from "./automations";
import { integrations } from "./integrations";

export const triggers = pgTable(
	"triggers",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		automationId: uuid("automation_id").notNull(),
		name: text(),
		description: text(),
		triggerType: text("trigger_type").default("webhook").notNull(),
		provider: text().notNull(),
		enabled: boolean().default(true),
		executionMode: text("execution_mode").default("auto"),
		allowAgenticRepoSelection: boolean("allow_agentic_repo_selection").default(false),
		agentInstructions: text("agent_instructions"),
		webhookSecret: text("webhook_secret"),
		webhookUrlPath: text("webhook_url_path"),
		pollingCron: text("polling_cron"),
		pollingEndpoint: text("polling_endpoint"),
		pollingState: jsonb("polling_state").default({}),
		lastPolledAt: timestamp("last_polled_at", { withTimezone: true, mode: "date" }),
		config: jsonb().default({}),
		integrationId: uuid("integration_id"),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
		repeatJobKey: text("repeat_job_key"),
	},
	(table) => [
		index("idx_triggers_automation").using(
			"btree",
			table.automationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_triggers_enabled_polling")
			.using(
				"btree",
				table.enabled.asc().nullsLast().op("bool_ops"),
				table.triggerType.asc().nullsLast().op("text_ops"),
			)
			.where(sql`((trigger_type = 'polling'::text) AND (enabled = true))`),
		index("idx_triggers_enabled_scheduled")
			.using(
				"btree",
				table.enabled.asc().nullsLast().op("bool_ops"),
				table.provider.asc().nullsLast().op("text_ops"),
			)
			.where(sql`((provider = 'scheduled'::text) AND (enabled = true))`),
		index("idx_triggers_org").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
		index("idx_triggers_repeat_job_key")
			.using("btree", table.repeatJobKey.asc().nullsLast().op("text_ops"))
			.where(sql`(repeat_job_key IS NOT NULL)`),
		index("idx_triggers_webhook_path").using(
			"btree",
			table.webhookUrlPath.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "triggers_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.automationId],
			foreignColumns: [automations.id],
			name: "triggers_automation_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.integrationId],
			foreignColumns: [integrations.id],
			name: "triggers_integration_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "triggers_created_by_fkey",
		}),
		unique("triggers_webhook_url_path_key").on(table.webhookUrlPath),
	],
);

export const triggerEvents = pgTable(
	"trigger_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		triggerId: uuid("trigger_id").notNull(),
		organizationId: text("organization_id").notNull(),
		externalEventId: text("external_event_id"),
		providerEventType: text("provider_event_type"),
		status: text().default("queued"),
		sessionId: uuid("session_id").references((): AnyPgColumn => sessions.id, {
			onDelete: "set null",
		}),
		rawPayload: jsonb("raw_payload").notNull(),
		parsedContext: jsonb("parsed_context"),
		errorMessage: text("error_message"),
		processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
		skipReason: text("skip_reason"),
		dedupKey: text("dedup_key"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		enrichedData: jsonb("enriched_data"),
		llmFilterResult: jsonb("llm_filter_result"),
		llmAnalysisResult: jsonb("llm_analysis_result"),
	},
	(table) => [
		uniqueIndex("idx_trigger_events_dedup")
			.using(
				"btree",
				table.triggerId.asc().nullsLast().op("uuid_ops"),
				table.dedupKey.asc().nullsLast().op("text_ops"),
			)
			.where(sql`(dedup_key IS NOT NULL)`),
		index("idx_trigger_events_org_status").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.status.asc().nullsLast().op("text_ops"),
		),
		index("idx_trigger_events_queued")
			.using(
				"btree",
				table.status.asc().nullsLast().op("text_ops"),
				table.createdAt.asc().nullsLast().op("timestamptz_ops"),
			)
			.where(sql`(status = 'queued'::text)`),
		index("idx_trigger_events_skipped")
			.using(
				"btree",
				table.triggerId.asc().nullsLast().op("uuid_ops"),
				table.status.asc().nullsLast().op("text_ops"),
			)
			.where(sql`(status = 'skipped'::text)`),
		index("idx_trigger_events_status").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
		),
		index("idx_trigger_events_trigger").using(
			"btree",
			table.triggerId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.triggerId],
			foreignColumns: [triggers.id],
			name: "trigger_events_trigger_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "trigger_events_organization_id_fkey",
		}).onDelete("cascade"),
	],
);

export const webhookInbox = pgTable(
	"webhook_inbox",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id"),
		provider: text().notNull(),
		externalId: text("external_id"),
		headers: jsonb(),
		payload: jsonb().notNull(),
		signature: text(),
		status: text().default("pending").notNull(),
		error: text(),
		processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
		receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_webhook_inbox_status").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
			table.receivedAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("idx_webhook_inbox_provider").using(
			"btree",
			table.provider.asc().nullsLast().op("text_ops"),
		),
		index("idx_webhook_inbox_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
	],
);

export const triggerPollGroups = pgTable(
	"trigger_poll_groups",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		provider: text().notNull(),
		integrationId: uuid("integration_id"),
		cronExpression: text("cron_expression").notNull(),
		enabled: boolean().default(true),
		lastPolledAt: timestamp("last_polled_at", { withTimezone: true, mode: "date" }),
		cursor: jsonb(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_trigger_poll_groups_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		index("idx_trigger_poll_groups_enabled").using(
			"btree",
			table.enabled.asc().nullsLast().op("bool_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "trigger_poll_groups_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.integrationId],
			foreignColumns: [integrations.id],
			name: "trigger_poll_groups_integration_id_fkey",
		}).onDelete("set null"),
		unique("uq_poll_groups_org_provider_integration")
			.on(table.organizationId, table.provider, table.integrationId)
			.nullsNotDistinct(),
	],
);

export const triggersRelations = relations(triggers, ({ one, many }) => ({
	organization: one(organization, {
		fields: [triggers.organizationId],
		references: [organization.id],
	}),
	automation: one(automations, {
		fields: [triggers.automationId],
		references: [automations.id],
	}),
	integration: one(integrations, {
		fields: [triggers.integrationId],
		references: [integrations.id],
	}),
	user: one(user, {
		fields: [triggers.createdBy],
		references: [user.id],
	}),
	triggerEvents: many(triggerEvents),
	sessions: many(sessions),
}));

export const triggerEventsRelations = relations(triggerEvents, ({ one, many }) => ({
	trigger: one(triggers, {
		fields: [triggerEvents.triggerId],
		references: [triggers.id],
	}),
	organization: one(organization, {
		fields: [triggerEvents.organizationId],
		references: [organization.id],
	}),
	session: one(sessions, {
		fields: [triggerEvents.sessionId],
		references: [sessions.id],
		relationName: "triggerEvents_sessionId_sessions_id",
	}),
	sessions: many(sessions, {
		relationName: "sessions_triggerEventId_triggerEvents_id",
	}),
	automationRuns: many(automationRuns),
}));

export const webhookInboxRelations = relations(webhookInbox, ({ one }) => ({
	organization: one(organization, {
		fields: [webhookInbox.organizationId],
		references: [organization.id],
	}),
}));

export const triggerPollGroupsRelations = relations(triggerPollGroups, ({ one }) => ({
	organization: one(organization, {
		fields: [triggerPollGroups.organizationId],
		references: [organization.id],
	}),
	integration: one(integrations, {
		fields: [triggerPollGroups.integrationId],
		references: [integrations.id],
	}),
}));

import { sessions } from "./sessions";
