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
import { slackInstallations } from "./slack";

type WorkerStatus = "active" | "automations_paused" | "degraded" | "failed" | "archived";
type WakeEventSource = "tick" | "webhook" | "manual" | "manual_message";
type WakeEventStatus = "queued" | "claimed" | "consumed" | "coalesced" | "cancelled" | "failed";
type WorkerRunStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "health_degraded";
type WorkerRunEventType =
	| "wake_started"
	| "triage_summary"
	| "source_observation"
	| "directive_received"
	| "task_spawned"
	| "action_requested"
	| "action_pending_approval"
	| "action_completed"
	| "action_failed"
	| "action_denied"
	| "action_expired"
	| "manager_note"
	| "wake_completed"
	| "wake_failed";
type SourceType = "sentry" | "linear" | "github";

export const workers = pgTable(
	"workers",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		systemPrompt: text("system_prompt"),
		status: text("status").$type<WorkerStatus>().notNull().default("active"),
		managerSessionId: uuid("manager_session_id").notNull(),
		modelId: text("model_id"),
		computeProfile: text("compute_profile"),
		lastErrorCode: text("last_error_code"),
		pausedAt: timestamp("paused_at", { withTimezone: true, mode: "date" }),
		pausedBy: text("paused_by"),
		createdBy: text("created_by"),
		slackChannelId: text("slack_channel_id"),
		slackInstallationId: uuid("slack_installation_id"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_workers_org").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
		index("idx_workers_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
		index("idx_workers_manager_session").using(
			"btree",
			table.managerSessionId.asc().nullsLast().op("uuid_ops"),
		),
		unique("uq_workers_manager_session").on(table.managerSessionId),
		check(
			"workers_status_check",
			sql`status = ANY (ARRAY['active'::text, 'automations_paused'::text, 'degraded'::text, 'failed'::text, 'archived'::text])`,
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "workers_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "workers_created_by_fkey",
		}),
		foreignKey({
			columns: [table.managerSessionId],
			foreignColumns: [sessions.id],
			name: "workers_manager_session_id_fkey",
		}),
		foreignKey({
			columns: [table.slackInstallationId],
			foreignColumns: [slackInstallations.id],
			name: "workers_slack_installation_id_fkey",
		}).onDelete("set null"),
	],
);

export const workerJobs = pgTable(
	"worker_jobs",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		workerId: uuid("worker_id").notNull(),
		organizationId: text("organization_id").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		checkInPrompt: text("check_in_prompt").notNull(),
		cronExpression: text("cron_expression").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		lastTickAt: timestamp("last_tick_at", { withTimezone: true, mode: "date" }),
		nextTickAt: timestamp("next_tick_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_worker_jobs_worker").using("btree", table.workerId.asc().nullsLast().op("uuid_ops")),
		index("idx_worker_jobs_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.workerId],
			foreignColumns: [workers.id],
			name: "worker_jobs_worker_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "worker_jobs_organization_id_fkey",
		}).onDelete("cascade"),
	],
);

export const wakeEvents = pgTable(
	"wake_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		workerId: uuid("worker_id").notNull(),
		organizationId: text("organization_id").notNull(),
		source: text("source").$type<WakeEventSource>().notNull(),
		status: text("status").$type<WakeEventStatus>().notNull().default("queued"),
		coalescedIntoWakeEventId: uuid("coalesced_into_wake_event_id"),
		payloadJson: jsonb("payload_json"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
		consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
		failedAt: timestamp("failed_at", { withTimezone: true, mode: "date" }),
	},
	(table) => [
		index("idx_wake_events_worker").using("btree", table.workerId.asc().nullsLast().op("uuid_ops")),
		index("idx_wake_events_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
		index("idx_wake_events_worker_status").using(
			"btree",
			table.workerId.asc().nullsLast().op("uuid_ops"),
			table.status.asc().nullsLast().op("text_ops"),
		),
		index("idx_wake_events_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		check(
			"wake_events_source_check",
			sql`source = ANY (ARRAY['tick'::text, 'webhook'::text, 'manual'::text, 'manual_message'::text])`,
		),
		check(
			"wake_events_status_check",
			sql`status = ANY (ARRAY['queued'::text, 'claimed'::text, 'consumed'::text, 'coalesced'::text, 'cancelled'::text, 'failed'::text])`,
		),
		foreignKey({
			columns: [table.workerId],
			foreignColumns: [workers.id],
			name: "wake_events_worker_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "wake_events_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.coalescedIntoWakeEventId],
			foreignColumns: [table.id],
			name: "wake_events_coalesced_into_wake_event_id_fkey",
		}).onDelete("set null"),
	],
);

export const workerRuns = pgTable(
	"worker_runs",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		workerId: uuid("worker_id").notNull(),
		organizationId: text("organization_id").notNull(),
		managerSessionId: uuid("manager_session_id").notNull(),
		wakeEventId: uuid("wake_event_id").notNull(),
		status: text("status").$type<WorkerRunStatus>().notNull().default("queued"),
		summary: text("summary"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
		completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
	},
	(table) => [
		index("idx_worker_runs_worker").using("btree", table.workerId.asc().nullsLast().op("uuid_ops")),
		index("idx_worker_runs_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
		index("idx_worker_runs_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		unique("uq_worker_runs_wake_event").on(table.wakeEventId),
		uniqueIndex("uq_worker_runs_one_active_per_worker")
			.on(table.workerId)
			.where(sql`status NOT IN ('completed', 'failed', 'cancelled', 'health_degraded')`),
		check(
			"worker_runs_status_check",
			sql`status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'health_degraded'::text])`,
		),
		foreignKey({
			columns: [table.workerId],
			foreignColumns: [workers.id],
			name: "worker_runs_worker_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "worker_runs_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.managerSessionId],
			foreignColumns: [sessions.id],
			name: "worker_runs_manager_session_id_fkey",
		}),
		foreignKey({
			columns: [table.wakeEventId],
			foreignColumns: [wakeEvents.id],
			name: "worker_runs_wake_event_id_fkey",
		}),
	],
);

export const workerRunEvents = pgTable(
	"worker_run_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		workerRunId: uuid("worker_run_id").notNull(),
		workerId: uuid("worker_id").notNull(),
		eventIndex: integer("event_index").notNull(),
		eventType: text("event_type").$type<WorkerRunEventType>().notNull(),
		summaryText: text("summary_text"),
		payloadJson: jsonb("payload_json"),
		payloadVersion: integer("payload_version").default(1),
		sessionId: uuid("session_id"),
		actionInvocationId: uuid("action_invocation_id"),
		dedupeKey: text("dedupe_key"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_worker_run_events_run").using(
			"btree",
			table.workerRunId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_worker_run_events_worker").using(
			"btree",
			table.workerId.asc().nullsLast().op("uuid_ops"),
		),
		unique("uq_worker_run_events_run_index").on(table.workerRunId, table.eventIndex),
		uniqueIndex("uq_worker_run_events_dedupe")
			.on(table.workerRunId, table.dedupeKey)
			.where(sql`dedupe_key IS NOT NULL`),
		foreignKey({
			columns: [table.workerRunId],
			foreignColumns: [workerRuns.id],
			name: "worker_run_events_worker_run_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.workerId],
			foreignColumns: [workers.id],
			name: "worker_run_events_worker_id_fkey",
		}).onDelete("cascade"),
	],
);

export const workerSourceBindings = pgTable(
	"worker_source_bindings",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		workerId: uuid("worker_id").notNull(),
		organizationId: text("organization_id").notNull(),
		sourceType: text("source_type").$type<SourceType>().notNull(),
		sourceRef: text("source_ref").notNull(),
		label: text("label"),
		config: jsonb("config").default({}),
		credentialOwnerId: text("credential_owner_id"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_worker_source_bindings_worker").using(
			"btree",
			table.workerId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_worker_source_bindings_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		unique("uq_worker_source_bindings_worker_source").on(
			table.workerId,
			table.sourceType,
			table.sourceRef,
		),
		check(
			"worker_source_bindings_source_type_check",
			sql`source_type = ANY (ARRAY['sentry'::text, 'linear'::text, 'github'::text])`,
		),
		foreignKey({
			columns: [table.workerId],
			foreignColumns: [workers.id],
			name: "worker_source_bindings_worker_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "worker_source_bindings_organization_id_fkey",
		}).onDelete("cascade"),
	],
);

export const workerSourceCursors = pgTable(
	"worker_source_cursors",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		bindingId: uuid("binding_id").notNull(),
		cursorValue: text("cursor_value"),
		lastPolledAt: timestamp("last_polled_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		unique("uq_worker_source_cursors_binding").on(table.bindingId),
		foreignKey({
			columns: [table.bindingId],
			foreignColumns: [workerSourceBindings.id],
			name: "worker_source_cursors_binding_id_fkey",
		}).onDelete("cascade"),
	],
);

export const workersRelations = relations(workers, ({ one, many }) => ({
	organization: one(organization, {
		fields: [workers.organizationId],
		references: [organization.id],
	}),
	createdByUser: one(user, {
		fields: [workers.createdBy],
		references: [user.id],
	}),
	managerSession: one(sessions, {
		fields: [workers.managerSessionId],
		references: [sessions.id],
	}),
	wakeEvents: many(wakeEvents),
	runs: many(workerRuns),
	jobs: many(workerJobs),
	sourceBindings: many(workerSourceBindings),
}));

export const workerJobsRelations = relations(workerJobs, ({ one }) => ({
	worker: one(workers, {
		fields: [workerJobs.workerId],
		references: [workers.id],
	}),
	organization: one(organization, {
		fields: [workerJobs.organizationId],
		references: [organization.id],
	}),
}));

export const wakeEventsRelations = relations(wakeEvents, ({ one }) => ({
	worker: one(workers, {
		fields: [wakeEvents.workerId],
		references: [workers.id],
	}),
	organization: one(organization, {
		fields: [wakeEvents.organizationId],
		references: [organization.id],
	}),
}));

export const workerRunsRelations = relations(workerRuns, ({ one, many }) => ({
	worker: one(workers, {
		fields: [workerRuns.workerId],
		references: [workers.id],
	}),
	organization: one(organization, {
		fields: [workerRuns.organizationId],
		references: [organization.id],
	}),
	managerSession: one(sessions, {
		fields: [workerRuns.managerSessionId],
		references: [sessions.id],
	}),
	wakeEvent: one(wakeEvents, {
		fields: [workerRuns.wakeEventId],
		references: [wakeEvents.id],
	}),
	events: many(workerRunEvents),
	taskSessions: many(sessions),
}));

export const workerRunEventsRelations = relations(workerRunEvents, ({ one }) => ({
	workerRun: one(workerRuns, {
		fields: [workerRunEvents.workerRunId],
		references: [workerRuns.id],
	}),
	worker: one(workers, {
		fields: [workerRunEvents.workerId],
		references: [workers.id],
	}),
}));

export const workerSourceBindingsRelations = relations(workerSourceBindings, ({ one, many }) => ({
	worker: one(workers, {
		fields: [workerSourceBindings.workerId],
		references: [workers.id],
	}),
	organization: one(organization, {
		fields: [workerSourceBindings.organizationId],
		references: [organization.id],
	}),
	cursors: many(workerSourceCursors),
}));

export const workerSourceCursorsRelations = relations(workerSourceCursors, ({ one }) => ({
	binding: one(workerSourceBindings, {
		fields: [workerSourceCursors.bindingId],
		references: [workerSourceBindings.id],
	}),
}));

import { sessions } from "./sessions";
