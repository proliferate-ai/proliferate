import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgPolicy,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { configurations } from "./configurations";
import { integrations } from "./integrations";
import { slackInstallations } from "./slack";

export const automations = pgTable(
	"automations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		name: text().default("Untitled Automation").notNull(),
		description: text(),
		enabled: boolean().default(true),
		agentInstructions: text("agent_instructions"),
		agentType: text("agent_type").default("opencode"),
		modelId: text("model_id").default("claude-sonnet-4-20250514"),
		allowAgenticRepoSelection: boolean("allow_agentic_repo_selection").default(false),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
		defaultConfigurationId: uuid("default_configuration_id"),
		llmFilterPrompt: text("llm_filter_prompt"),
		enabledTools: jsonb("enabled_tools").default({}),
		llmAnalysisPrompt: text("llm_analysis_prompt"),
		configSelectionStrategy: text("config_selection_strategy").default("fixed"),
		fallbackConfigurationId: uuid("fallback_configuration_id"),
		allowedConfigurationIds: jsonb("allowed_configuration_ids"),
		notificationDestinationType: text("notification_destination_type").default("none"),
		notificationChannelId: text("notification_channel_id"),
		notificationSlackUserId: text("notification_slack_user_id"),
		notificationSlackInstallationId: uuid("notification_slack_installation_id"),
		actionModes: jsonb("action_modes"),
		workerId: uuid("worker_id"),
		sourceTemplateId: text("source_template_id"),
	},
	(table) => [
		index("idx_automations_enabled")
			.using("btree", table.enabled.asc().nullsLast().op("bool_ops"))
			.where(sql`(enabled = true)`),
		index("idx_automations_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		index("idx_automations_configuration").using(
			"btree",
			table.defaultConfigurationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_automations_worker_id").using(
			"btree",
			table.workerId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "automations_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "automations_created_by_fkey",
		}),
		foreignKey({
			columns: [table.defaultConfigurationId],
			foreignColumns: [configurations.id],
			name: "automations_default_configuration_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.notificationSlackInstallationId],
			foreignColumns: [slackInstallations.id],
			name: "automations_notification_slack_installation_id_fkey",
		}).onDelete("set null"),
		pgPolicy("Users can delete automations in their org", {
			as: "permissive",
			for: "delete",
			to: ["public"],
			using: sql`(organization_id IN ( SELECT member."organizationId"
   FROM member
  WHERE (member."userId" = auth.uid())))`,
		}),
		pgPolicy("Users can update automations in their org", {
			as: "permissive",
			for: "update",
			to: ["public"],
		}),
		pgPolicy("Users can insert automations in their org", {
			as: "permissive",
			for: "insert",
			to: ["public"],
		}),
		pgPolicy("Users can view automations in their org", {
			as: "permissive",
			for: "select",
			to: ["public"],
		}),
		check(
			"chk_automations_dm_user_slack_id",
			sql`(notification_destination_type != 'slack_dm_user') OR (notification_slack_user_id IS NOT NULL)`,
		),
	],
);

export const automationConnections = pgTable(
	"automation_connections",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		automationId: uuid("automation_id").notNull(),
		integrationId: uuid("integration_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_automation_connections_automation").using(
			"btree",
			table.automationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_automation_connections_integration").using(
			"btree",
			table.integrationId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.automationId],
			foreignColumns: [automations.id],
			name: "automation_connections_automation_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.integrationId],
			foreignColumns: [integrations.id],
			name: "automation_connections_integration_id_fkey",
		}).onDelete("cascade"),
		unique("automation_connections_automation_id_integration_id_key").on(
			table.automationId,
			table.integrationId,
		),
	],
);

export const automationRuns = pgTable(
	"automation_runs",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		automationId: uuid("automation_id").notNull(),
		triggerEventId: uuid("trigger_event_id").notNull(),
		triggerId: uuid("trigger_id"),
		status: text().default("queued").notNull(),
		statusReason: text("status_reason"),
		failureStage: text("failure_stage"),
		leaseOwner: text("lease_owner"),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
		leaseVersion: integer("lease_version").default(0).notNull(),
		attempt: integer("attempt").default(0).notNull(),
		queuedAt: timestamp("queued_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		enrichmentStartedAt: timestamp("enrichment_started_at", {
			withTimezone: true,
			mode: "date",
		}),
		enrichmentCompletedAt: timestamp("enrichment_completed_at", {
			withTimezone: true,
			mode: "date",
		}),
		executionStartedAt: timestamp("execution_started_at", {
			withTimezone: true,
			mode: "date",
		}),
		promptSentAt: timestamp("prompt_sent_at", { withTimezone: true, mode: "date" }),
		completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
		lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: "date" }),
		deadlineAt: timestamp("deadline_at", { withTimezone: true, mode: "date" }),
		sessionId: uuid("session_id"),
		sessionCreatedAt: timestamp("session_created_at", { withTimezone: true, mode: "date" }),
		completionId: text("completion_id"),
		completionJson: jsonb("completion_json"),
		completionArtifactRef: text("completion_artifact_ref"),
		enrichmentJson: jsonb("enrichment_json"),
		enrichmentArtifactRef: text("enrichment_artifact_ref"),
		sourcesArtifactRef: text("sources_artifact_ref"),
		policyArtifactRef: text("policy_artifact_ref"),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		assignedTo: text("assigned_to"),
		assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_automation_runs_status_lease").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
			table.leaseExpiresAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("idx_automation_runs_org_status").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.status.asc().nullsLast().op("text_ops"),
		),
		index("idx_automation_runs_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		uniqueIndex("idx_automation_runs_trigger_event").using(
			"btree",
			table.triggerEventId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "automation_runs_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.automationId],
			foreignColumns: [automations.id],
			name: "automation_runs_automation_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.triggerEventId],
			foreignColumns: [triggerEvents.id],
			name: "automation_runs_trigger_event_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.triggerId],
			foreignColumns: [triggers.id],
			name: "automation_runs_trigger_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "automation_runs_session_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [user.id],
			name: "automation_runs_assigned_to_fkey",
		}).onDelete("set null"),
		index("idx_automation_runs_assigned_to").using(
			"btree",
			table.assignedTo.asc().nullsLast().op("text_ops"),
		),
	],
);

export const automationRunEvents = pgTable(
	"automation_run_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		runId: uuid("run_id").notNull(),
		type: text("type").notNull(),
		fromStatus: text("from_status"),
		toStatus: text("to_status"),
		data: jsonb("data"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_automation_run_events_run").using(
			"btree",
			table.runId.asc().nullsLast().op("uuid_ops"),
			table.createdAt.desc().nullsLast().op("timestamptz_ops"),
		),
		foreignKey({
			columns: [table.runId],
			foreignColumns: [automationRuns.id],
			name: "automation_run_events_run_id_fkey",
		}).onDelete("cascade"),
	],
);

export const automationSideEffects = pgTable(
	"automation_side_effects",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		runId: uuid("run_id").notNull(),
		organizationId: text("organization_id").notNull(),
		effectId: text("effect_id").notNull(),
		kind: text().notNull(),
		provider: text(),
		requestHash: text("request_hash"),
		responseJson: jsonb("response_json"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		unique("automation_side_effects_org_effect_key").on(table.organizationId, table.effectId),
		index("idx_automation_side_effects_run").using(
			"btree",
			table.runId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.runId],
			foreignColumns: [automationRuns.id],
			name: "automation_side_effects_run_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "automation_side_effects_organization_id_fkey",
		}).onDelete("cascade"),
	],
);

export const outbox = pgTable(
	"outbox",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		kind: text().notNull(),
		payload: jsonb("payload").notNull(),
		status: text().default("pending").notNull(),
		attempts: integer("attempts").default(0).notNull(),
		availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }).defaultNow(),
		claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
		lastError: text("last_error"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_outbox_status_available").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
			table.availableAt.asc().nullsLast().op("timestamptz_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "outbox_organization_id_fkey",
		}).onDelete("cascade"),
	],
);

export const automationConnectionsRelations = relations(automationConnections, ({ one }) => ({
	automation: one(automations, {
		fields: [automationConnections.automationId],
		references: [automations.id],
	}),
	integration: one(integrations, {
		fields: [automationConnections.integrationId],
		references: [integrations.id],
	}),
}));

export const automationsRelations = relations(automations, ({ one, many }) => ({
	automationConnections: many(automationConnections),
	triggers: many(triggers),
	organization: one(organization, {
		fields: [automations.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [automations.createdBy],
		references: [user.id],
	}),
	configuration: one(configurations, {
		fields: [automations.defaultConfigurationId],
		references: [configurations.id],
	}),
	schedules: many(schedules),
	sessions: many(sessions),
}));

export const automationRunsRelations = relations(automationRuns, ({ one, many }) => ({
	organization: one(organization, {
		fields: [automationRuns.organizationId],
		references: [organization.id],
	}),
	automation: one(automations, {
		fields: [automationRuns.automationId],
		references: [automations.id],
	}),
	triggerEvent: one(triggerEvents, {
		fields: [automationRuns.triggerEventId],
		references: [triggerEvents.id],
	}),
	trigger: one(triggers, {
		fields: [automationRuns.triggerId],
		references: [triggers.id],
	}),
	session: one(sessions, {
		fields: [automationRuns.sessionId],
		references: [sessions.id],
	}),
	assignee: one(user, {
		fields: [automationRuns.assignedTo],
		references: [user.id],
	}),
	events: many(automationRunEvents),
	sideEffects: many(automationSideEffects),
}));

export const automationRunEventsRelations = relations(automationRunEvents, ({ one }) => ({
	run: one(automationRuns, {
		fields: [automationRunEvents.runId],
		references: [automationRuns.id],
	}),
}));

export const automationSideEffectsRelations = relations(automationSideEffects, ({ one }) => ({
	run: one(automationRuns, {
		fields: [automationSideEffects.runId],
		references: [automationRuns.id],
	}),
	organization: one(organization, {
		fields: [automationSideEffects.organizationId],
		references: [organization.id],
	}),
}));

export const outboxRelations = relations(outbox, ({ one }) => ({
	organization: one(organization, {
		fields: [outbox.organizationId],
		references: [organization.id],
	}),
}));

import { schedules } from "./schedules";
import { sessions } from "./sessions";
import { triggerEvents, triggers } from "./triggers";
