/**
 * Sessions schema — V1 session model and session-related tables.
 *
 * Tables: sessions, session_capabilities, session_skills, session_messages,
 *         session_acl, session_user_state, session_pull_requests
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
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { configurations } from "./configurations";
import { repos } from "./repos";

// ============================================
// Sessions
// ============================================

export const sessions = pgTable(
	"sessions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		repoId: uuid("repo_id").references(() => repos.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id),
		createdBy: text("created_by").references(() => user.id),

		// Type (legacy column, kept for compat)
		sessionType: text("session_type").default("coding"), // 'setup', 'coding', 'terminal'

		// V1 session kind: manager | task | setup
		kind: text("kind").default("task"),

		// Legacy status (kept for compat)
		status: text("status").default("starting"), // 'starting', 'running', 'paused', 'stopped', 'failed'

		// V1 runtime status: starting | running | paused | completed | failed | cancelled
		runtimeStatus: text("runtime_status").default("starting"),

		// V1 operator status: active | waiting_for_approval | needs_input | ready_for_review | errored | done
		operatorStatus: text("operator_status").default("active"),

		// V1 visibility: private | shared | org
		visibility: text("visibility").default("private"),

		// Sandbox
		sandboxId: text("sandbox_id"),
		sandboxProvider: text("sandbox_provider").default("modal"),
		snapshotId: text("snapshot_id"),

		// Configuration reference (legacy)
		configurationId: uuid("configuration_id").references(() => configurations.id, {
			onDelete: "set null",
		}),

		// V1 worker linkage
		workerId: uuid("worker_id"),
		workerRunId: uuid("worker_run_id"),

		// V1 repo baseline linkage
		repoBaselineId: uuid("repo_baseline_id"),
		repoBaselineTargetId: uuid("repo_baseline_target_id"),

		// V1 capabilities version (incremented on capability row changes)
		capabilitiesVersion: integer("capabilities_version").default(1),

		// Git
		branchName: text("branch_name"),
		baseCommitSha: text("base_commit_sha"),

		// Parent session / lineage
		parentSessionId: uuid("parent_session_id"),
		continuedFromSessionId: uuid("continued_from_session_id"),
		rerunOfSessionId: uuid("rerun_of_session_id"),
		initialPrompt: text("initial_prompt"),

		// V1 manager replacement lineage
		replacesSessionId: uuid("replaces_session_id"),
		replacedBySessionId: uuid("replaced_by_session_id"),

		// Display
		title: text("title"),
		titleStatus: text("title_status"), // "generating" | null

		// Initial prompt delivery guard
		initialPromptSentAt: timestamp("initial_prompt_sent_at", { withTimezone: true }),

		// Automation/Trigger linkage (legacy)
		automationId: uuid("automation_id"), // FK added separately
		triggerId: uuid("trigger_id"), // FK added separately
		triggerEventId: uuid("trigger_event_id"), // FK added separately

		// Timestamps
		startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
		lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow(),
		pausedAt: timestamp("paused_at", { withTimezone: true }),
		endedAt: timestamp("ended_at", { withTimezone: true }),

		// V1 last visible update (for unread computation)
		lastVisibleUpdateAt: timestamp("last_visible_update_at", { withTimezone: true }),

		// V1 structured outcome (terminal task sessions)
		outcomeJson: jsonb("outcome_json"),
		outcomeVersion: integer("outcome_version"),
		outcomePersistedAt: timestamp("outcome_persisted_at", { withTimezone: true }),

		// V1 archive/delete soft state
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
		deletedBy: text("deleted_by"),

		// Config
		idleTimeoutMinutes: integer("idle_timeout_minutes").default(30),
		autoDeleteDays: integer("auto_delete_days").default(7),

		// CLI fields
		origin: text("origin").default("web"), // 'web', 'cli'
		localPathHash: text("local_path_hash"),

		// Client fields
		clientType: text("client_type"), // 'slack', 'web', 'cli'
		clientMetadata: jsonb("client_metadata"),

		// Gateway fields
		codingAgentSessionId: text("coding_agent_session_id"),
		openCodeTunnelUrl: text("open_code_tunnel_url"),
		previewTunnelUrl: text("preview_tunnel_url"),
		agentConfig: jsonb("agent_config"),
		systemPrompt: text("system_prompt"),

		// Billing fields
		meteredThroughAt: timestamp("metered_through_at", { withTimezone: true }),
		lastSeenAliveAt: timestamp("last_seen_alive_at", { withTimezone: true }),
		aliveCheckFailures: integer("alive_check_failures").default(0),
		pauseReason: text("pause_reason"),
		stopReason: text("stop_reason"),

		// Sandbox lifecycle
		sandboxExpiresAt: timestamp("sandbox_expires_at", { withTimezone: true }),

		// Source (for session tracking)
		source: text("source"),

		// Phase 2: Session telemetry (legacy)
		outcome: text("outcome"),
		summary: text("summary"),
		prUrls: jsonb("pr_urls"),
		metrics: jsonb("metrics"),
		latestTask: text("latest_task"),
	},
	(table) => [
		index("idx_sessions_org").on(table.organizationId),
		index("idx_sessions_repo").on(table.repoId),
		index("idx_sessions_status").on(table.status),
		index("idx_sessions_parent").on(table.parentSessionId),
		index("idx_sessions_automation").on(table.automationId),
		index("idx_sessions_trigger").on(table.triggerId),
		index("idx_sessions_configuration").on(table.configurationId),
		index("idx_sessions_local_path_hash").on(table.localPathHash),
		index("idx_sessions_client_type").on(table.clientType),
		index("idx_sessions_sandbox_expires_at").on(table.sandboxExpiresAt),

		// V1 indexes
		index("idx_sessions_kind").on(table.kind),
		index("idx_sessions_runtime_status").on(table.runtimeStatus),
		index("idx_sessions_operator_status").on(table.operatorStatus),
		index("idx_sessions_worker").on(table.workerId),
		index("idx_sessions_worker_run").on(table.workerRunId),

		// One non-terminal setup session per repo (partial unique)
		uniqueIndex("uq_sessions_one_active_setup_per_repo")
			.on(table.repoId)
			.where(sql`kind = 'setup' AND runtime_status NOT IN ('completed', 'failed', 'cancelled')`),
		check(
			"sessions_kind_check",
			sql`kind = ANY (ARRAY['manager'::text, 'task'::text, 'setup'::text])`,
		),
		check(
			"sessions_runtime_status_check",
			sql`runtime_status = ANY (ARRAY['starting'::text, 'running'::text, 'paused'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])`,
		),
		check(
			"sessions_operator_status_check",
			sql`operator_status = ANY (ARRAY['active'::text, 'waiting_for_approval'::text, 'needs_input'::text, 'ready_for_review'::text, 'errored'::text, 'done'::text])`,
		),
		check(
			"sessions_visibility_check",
			sql`visibility = ANY (ARRAY['private'::text, 'shared'::text, 'org'::text])`,
		),
		check(
			"sessions_manager_worker_run_null_check",
			sql`(kind != 'manager'::text) OR (worker_run_id IS NULL)`,
		),
		check(
			"sessions_manager_shape_check",
			sql`(kind != 'manager'::text) OR (worker_id IS NOT NULL AND worker_run_id IS NULL AND continued_from_session_id IS NULL AND rerun_of_session_id IS NULL)`,
		),
		check(
			"sessions_task_linkage_check",
			sql`(kind != 'task'::text) OR (repo_id IS NOT NULL AND repo_baseline_id IS NOT NULL AND repo_baseline_target_id IS NOT NULL)`,
		),
		check(
			"sessions_setup_requires_repo_check",
			sql`(kind != 'setup'::text) OR (repo_id IS NOT NULL)`,
		),
	],
);

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
	organization: one(organization, {
		fields: [sessions.organizationId],
		references: [organization.id],
	}),
	repo: one(repos, {
		fields: [sessions.repoId],
		references: [repos.id],
	}),
	createdByUser: one(user, {
		fields: [sessions.createdBy],
		references: [user.id],
	}),
	configuration: one(configurations, {
		fields: [sessions.configurationId],
		references: [configurations.id],
	}),
	parentSession: one(sessions, {
		fields: [sessions.parentSessionId],
		references: [sessions.id],
		relationName: "parentChild",
	}),
	childSessions: many(sessions, { relationName: "parentChild" }),
	automation: one(automations, {
		fields: [sessions.automationId],
		references: [automations.id],
	}),
	trigger: one(triggers, {
		fields: [sessions.triggerId],
		references: [triggers.id],
	}),
	triggerEvent: one(triggerEvents, {
		fields: [sessions.triggerEventId],
		references: [triggerEvents.id],
	}),
	slackConversations: many(slackConversations),
	capabilities: many(sessionCapabilities),
	skills: many(sessionSkills),
	messages: many(sessionMessages),
	acl: many(sessionAcl),
	pullRequests: many(sessionPullRequests),
}));

// ============================================
// Session Capabilities
// ============================================

export const sessionCapabilities = pgTable(
	"session_capabilities",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),

		// Capability key (e.g. "linear.update_issue", "source.github.read")
		capabilityKey: text("capability_key").notNull(),

		// Mode: allow | require_approval | deny
		mode: text("mode").notNull().default("allow"),

		// Scope constraints (optional JSON)
		scope: jsonb("scope"),

		// Origin tracking
		origin: text("origin"), // 'org_template' | 'worker_template' | 'manual'

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_session_capabilities_session").on(table.sessionId),

		// One effective capability per (session_id, capability_key)
		unique("uq_session_capabilities_session_key").on(table.sessionId, table.capabilityKey),
		check(
			"session_capabilities_mode_check",
			sql`mode = ANY (ARRAY['allow'::text, 'require_approval'::text, 'deny'::text])`,
		),
	],
);

export const sessionCapabilitiesRelations = relations(sessionCapabilities, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionCapabilities.sessionId],
		references: [sessions.id],
	}),
}));

// ============================================
// Session Skills
// ============================================

export const sessionSkills = pgTable(
	"session_skills",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),

		// Skill key
		skillKey: text("skill_key").notNull(),

		// Skill configuration
		configJson: jsonb("config_json"),

		// Origin tracking
		origin: text("origin"), // 'worker_template' | 'org_default' | 'setup_pack'

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_session_skills_session").on(table.sessionId),

		// One effective skill per (session_id, skill_key)
		unique("uq_session_skills_session_key").on(table.sessionId, table.skillKey),
	],
);

export const sessionSkillsRelations = relations(sessionSkills, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionSkills.sessionId],
		references: [sessions.id],
	}),
}));

// ============================================
// Session Messages (queued control-plane transport)
// ============================================

export const sessionMessages = pgTable(
	"session_messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),

		// Direction: user_to_manager | user_to_task | manager_to_task | task_to_manager
		direction: text("direction").notNull(),

		// Message type (e.g. 'directive', 'follow_up', 'status_event', 'cancel')
		messageType: text("message_type").notNull(),

		// Payload
		payloadJson: jsonb("payload_json").notNull(),

		// Delivery state: queued | delivered | consumed | failed
		deliveryState: text("delivery_state").notNull().default("queued"),

		// Dedupe
		dedupeKey: text("dedupe_key"),

		// Lifecycle timestamps
		queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
		deliverAfter: timestamp("deliver_after", { withTimezone: true }),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }),
		consumedAt: timestamp("consumed_at", { withTimezone: true }),
		failedAt: timestamp("failed_at", { withTimezone: true }),
		failureReason: text("failure_reason"),

		// Sender context
		senderUserId: text("sender_user_id"),
		senderSessionId: uuid("sender_session_id"),
	},
	(table) => [
		index("idx_session_messages_session").on(table.sessionId),
		index("idx_session_messages_delivery_state").on(table.deliveryState),
		index("idx_session_messages_session_state").on(table.sessionId, table.deliveryState),
		check(
			"session_messages_direction_check",
			sql`direction = ANY (ARRAY['user_to_manager'::text, 'user_to_task'::text, 'manager_to_task'::text, 'task_to_manager'::text])`,
		),
		check(
			"session_messages_delivery_state_check",
			sql`delivery_state = ANY (ARRAY['queued'::text, 'delivered'::text, 'consumed'::text, 'failed'::text])`,
		),
	],
);

export const sessionMessagesRelations = relations(sessionMessages, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionMessages.sessionId],
		references: [sessions.id],
	}),
}));

// ============================================
// Session ACL
// ============================================

export const sessionAcl = pgTable(
	"session_acl",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		// Role: viewer | editor | reviewer
		role: text("role").notNull(),

		grantedBy: text("granted_by"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_session_acl_session").on(table.sessionId),
		index("idx_session_acl_user").on(table.userId),

		// One ACL entry per (session_id, user_id)
		unique("uq_session_acl_session_user").on(table.sessionId, table.userId),
		check(
			"session_acl_role_check",
			sql`role = ANY (ARRAY['viewer'::text, 'editor'::text, 'reviewer'::text])`,
		),
	],
);

export const sessionAclRelations = relations(sessionAcl, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionAcl.sessionId],
		references: [sessions.id],
	}),
	user: one(user, {
		fields: [sessionAcl.userId],
		references: [user.id],
	}),
}));

// ============================================
// Session User State (per-user unread markers)
// ============================================

export const sessionUserState = pgTable(
	"session_user_state",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		// Last viewed timestamp (unread = sessions.lastVisibleUpdateAt > lastViewedAt)
		lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_session_user_state_session").on(table.sessionId),
		index("idx_session_user_state_user").on(table.userId),

		// One row per (session_id, user_id)
		unique("uq_session_user_state_session_user").on(table.sessionId, table.userId),
	],
);

export const sessionUserStateRelations = relations(sessionUserState, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionUserState.sessionId],
		references: [sessions.id],
	}),
	user: one(user, {
		fields: [sessionUserState.userId],
		references: [user.id],
	}),
}));

// ============================================
// Session Pull Requests
// ============================================

export const sessionPullRequests = pgTable(
	"session_pull_requests",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		repoId: uuid("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),

		// Branch
		branchName: text("branch_name").notNull(),

		// Provider (e.g. 'github')
		provider: text("provider").notNull(),

		// PR state
		pullRequestNumber: integer("pull_request_number"),
		pullRequestUrl: text("pull_request_url"),
		pullRequestState: text("pull_request_state"), // open | closed | merged | draft
		headCommitSha: text("head_commit_sha"),

		// Continuation lineage
		continuedFromSessionId: uuid("continued_from_session_id"),

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_session_pull_requests_session").on(table.sessionId),
		index("idx_session_pull_requests_repo").on(table.repoId),
		check(
			"session_pull_requests_state_check",
			sql`pull_request_state IS NULL OR pull_request_state = ANY (ARRAY['open'::text, 'closed'::text, 'merged'::text, 'draft'::text])`,
		),
	],
);

export const sessionPullRequestsRelations = relations(sessionPullRequests, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionPullRequests.sessionId],
		references: [sessions.id],
	}),
	repo: one(repos, {
		fields: [sessionPullRequests.repoId],
		references: [repos.id],
	}),
}));

// Forward declarations
import { automations } from "./automations";
import { slackConversations } from "./slack";
import { triggerEvents, triggers } from "./triggers";
