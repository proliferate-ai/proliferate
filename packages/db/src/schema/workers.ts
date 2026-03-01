/**
 * Workers schema — V1 coworker runtime entities.
 *
 * Tables: workers, wake_events, worker_runs, worker_run_events
 */

import { sql } from "drizzle-orm";
import {
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

// ============================================
// Workers
// ============================================

export const workers = pgTable(
	"workers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Identity
		name: text("name").notNull(),
		objective: text("objective"),

		// Status: active | paused | degraded | failed
		status: text("status").notNull().default("active"),

		// Current manager session (1:1, points to sessions(kind=manager))
		managerSessionId: uuid("manager_session_id")
			.notNull()
			.references(() => sessions.id),

		// Agent config
		modelId: text("model_id"),
		computeProfile: text("compute_profile"),

		// Operational timestamps
		lastWakeAt: timestamp("last_wake_at", { withTimezone: true }),
		lastCompletedRunAt: timestamp("last_completed_run_at", { withTimezone: true }),
		lastErrorCode: text("last_error_code"),
		pausedAt: timestamp("paused_at", { withTimezone: true }),
		pausedBy: text("paused_by"),

		// Metadata
		createdBy: text("created_by").references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_workers_org").on(table.organizationId),
		index("idx_workers_status").on(table.status),
		index("idx_workers_manager_session").on(table.managerSessionId),
		unique("uq_workers_manager_session").on(table.managerSessionId),
		check(
			"workers_status_check",
			sql`status = ANY (ARRAY['active'::text, 'paused'::text, 'degraded'::text, 'failed'::text])`,
		),
	],
);

// ============================================
// Wake Events
// ============================================

export const wakeEvents = pgTable(
	"wake_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		workerId: uuid("worker_id")
			.notNull()
			.references(() => workers.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Source: tick | webhook | manual | manual_message (immutable)
		source: text("source").notNull(),

		// Status: queued | claimed | consumed | coalesced | cancelled | failed
		status: text("status").notNull().default("queued"),

		// Coalescing
		coalescedIntoWakeEventId: uuid("coalesced_into_wake_event_id"),

		// Payload context (aggregated refs for consumed wakes)
		payloadJson: jsonb("payload_json"),

		// Timestamps
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		consumedAt: timestamp("consumed_at", { withTimezone: true }),
		failedAt: timestamp("failed_at", { withTimezone: true }),
	},
	(table) => [
		index("idx_wake_events_worker").on(table.workerId),
		index("idx_wake_events_status").on(table.status),
		index("idx_wake_events_worker_status").on(table.workerId, table.status),
		index("idx_wake_events_org").on(table.organizationId),
		check(
			"wake_events_source_check",
			sql`source = ANY (ARRAY['tick'::text, 'webhook'::text, 'manual'::text, 'manual_message'::text])`,
		),
		check(
			"wake_events_status_check",
			sql`status = ANY (ARRAY['queued'::text, 'claimed'::text, 'consumed'::text, 'coalesced'::text, 'cancelled'::text, 'failed'::text])`,
		),
		foreignKey({
			columns: [table.coalescedIntoWakeEventId],
			foreignColumns: [table.id],
			name: "wake_events_coalesced_into_wake_event_id_fkey",
		}).onDelete("set null"),
	],
);

// ============================================
// Worker Runs
// ============================================

export const workerRuns = pgTable(
	"worker_runs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		workerId: uuid("worker_id")
			.notNull()
			.references(() => workers.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Required FK: immutable snapshot of executing manager session
		managerSessionId: uuid("manager_session_id")
			.notNull()
			.references(() => sessions.id),

		// Required FK: unique per wake event
		wakeEventId: uuid("wake_event_id")
			.notNull()
			.references(() => wakeEvents.id),

		// Status: queued | running | completed | failed | cancelled | health_degraded
		status: text("status").notNull().default("queued"),

		// Summary
		summary: text("summary"),

		// Timestamps
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(table) => [
		index("idx_worker_runs_worker").on(table.workerId),
		index("idx_worker_runs_status").on(table.status),
		index("idx_worker_runs_org").on(table.organizationId),

		// wakeEventId is required + unique
		unique("uq_worker_runs_wake_event").on(table.wakeEventId),

		// One active/non-terminal run per worker (partial unique index)
		uniqueIndex("uq_worker_runs_one_active_per_worker")
			.on(table.workerId)
			.where(sql`status NOT IN ('completed', 'failed', 'cancelled', 'health_degraded')`),
		check(
			"worker_runs_status_check",
			sql`status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'health_degraded'::text])`,
		),
	],
);

// ============================================
// Worker Run Events
// ============================================

export const workerRunEvents = pgTable(
	"worker_run_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		workerRunId: uuid("worker_run_id")
			.notNull()
			.references(() => workerRuns.id, { onDelete: "cascade" }),
		workerId: uuid("worker_id")
			.notNull()
			.references(() => workers.id, { onDelete: "cascade" }),

		// Ordering: monotonic per run
		eventIndex: integer("event_index").notNull(),

		// Event type (canonical values from spec)
		eventType: text("event_type").notNull(),

		// Content
		summaryText: text("summary_text"),
		payloadJson: jsonb("payload_json"),
		payloadVersion: integer("payload_version").default(1),

		// Optional linkage
		sessionId: uuid("session_id"),
		actionInvocationId: uuid("action_invocation_id"),

		// Dedupe
		dedupeKey: text("dedupe_key"),

		// Timestamps
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_worker_run_events_run").on(table.workerRunId),
		index("idx_worker_run_events_worker").on(table.workerId),

		// One row per (worker_run_id, event_index)
		unique("uq_worker_run_events_run_index").on(table.workerRunId, table.eventIndex),

		// Optional dedupe: unique (worker_run_id, dedupe_key) where dedupe_key is non-null
		uniqueIndex("uq_worker_run_events_dedupe")
			.on(table.workerRunId, table.dedupeKey)
			.where(sql`dedupe_key IS NOT NULL`),
	],
);

// Forward declarations
import { sessions } from "./sessions";
