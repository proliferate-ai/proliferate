/**
 * Triggers schema
 */

import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { automations } from "./automations";
import { integrations } from "./integrations";

// ============================================
// Triggers
// ============================================

export const triggers = pgTable(
	"triggers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		automationId: uuid("automation_id")
			.notNull()
			.references(() => automations.id, { onDelete: "cascade" }),

		// Identity (deprecated - use automations.name/description)
		name: text("name"),
		description: text("description"),

		// Type
		triggerType: text("trigger_type").notNull().default("webhook"), // 'webhook', 'polling'

		// Provider
		provider: text("provider").notNull(), // 'sentry', 'linear', 'github', 'custom'

		// Status
		enabled: boolean("enabled").default(true),

		// Execution mode (deprecated)
		executionMode: text("execution_mode").default("auto"),

		// Deprecated repo targeting fields
		allowAgenticRepoSelection: boolean("allow_agentic_repo_selection").default(false),

		// Instructions (deprecated)
		agentInstructions: text("agent_instructions"),

		// Webhook config
		webhookSecret: text("webhook_secret"),
		webhookUrlPath: text("webhook_url_path").unique(),

		// Polling config
		pollingCron: text("polling_cron"),
		pollingEndpoint: text("polling_endpoint"),
		pollingState: jsonb("polling_state").default({}),
		lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),

		// Integration-specific config
		config: jsonb("config").default({}),

		// Auth reference
		integrationId: uuid("integration_id").references(() => integrations.id, {
			onDelete: "set null",
		}),

		// Metadata
		createdBy: text("created_by").references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_triggers_org").on(table.organizationId),
		index("idx_triggers_automation").on(table.automationId),
		index("idx_triggers_webhook_path").on(table.webhookUrlPath),
		index("idx_triggers_enabled_polling").on(table.enabled, table.triggerType),
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
	createdByUser: one(user, {
		fields: [triggers.createdBy],
		references: [user.id],
	}),
	events: many(triggerEvents),
	sessions: many(sessions),
}));

// ============================================
// Trigger Events
// ============================================

export const triggerEvents = pgTable(
	"trigger_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		triggerId: uuid("trigger_id")
			.notNull()
			.references(() => triggers.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Event identification
		externalEventId: text("external_event_id"),
		providerEventType: text("provider_event_type"),

		// Status
		status: text("status").default("queued"), // 'queued', 'processing', 'completed', 'failed', 'skipped'

		// Session linkage
		sessionId: uuid("session_id"), // FK to sessions added later

		// Raw event payload
		rawPayload: jsonb("raw_payload").notNull(),

		// Parsed context
		parsedContext: jsonb("parsed_context"),

		// Processing info
		errorMessage: text("error_message"),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		skipReason: text("skip_reason"),

		// Deduplication
		dedupKey: text("dedup_key"),

		// LLM processing results
		enrichedData: jsonb("enriched_data"),
		llmFilterResult: jsonb("llm_filter_result"),
		llmAnalysisResult: jsonb("llm_analysis_result"),

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_trigger_events_trigger").on(table.triggerId),
		index("idx_trigger_events_status").on(table.status),
		index("idx_trigger_events_org_status").on(table.organizationId, table.status),
		uniqueIndex("idx_trigger_events_dedup").on(table.triggerId, table.dedupKey),
		index("idx_trigger_events_queued").on(table.status, table.createdAt),
		index("idx_trigger_events_skipped").on(table.triggerId, table.status),
	],
);

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
	}),
	actions: many(triggerEventActions),
}));

// ============================================
// Trigger Event Actions (tool execution audit log)
// ============================================

export const triggerEventActions = pgTable(
	"trigger_event_actions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		triggerEventId: uuid("trigger_event_id")
			.notNull()
			.references(() => triggerEvents.id, { onDelete: "cascade" }),
		toolName: text("tool_name").notNull(),
		status: text("status").default("pending"),
		inputData: jsonb("input_data"),
		outputData: jsonb("output_data"),
		errorMessage: text("error_message"),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		durationMs: integer("duration_ms"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_trigger_event_actions_event").on(table.triggerEventId),
		index("idx_trigger_event_actions_status").on(table.status),
	],
);

export const triggerEventActionsRelations = relations(triggerEventActions, ({ one }) => ({
	triggerEvent: one(triggerEvents, {
		fields: [triggerEventActions.triggerEventId],
		references: [triggerEvents.id],
	}),
}));

// Forward declaration
import { sessions } from "./sessions";
