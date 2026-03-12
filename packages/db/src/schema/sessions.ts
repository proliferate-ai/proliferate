import { relations, sql } from "drizzle-orm";
import {
	type AnyPgColumn,
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
import { configurations } from "./configurations";
import { repoBaselineTargets, repoBaselines, repos } from "./repos";

export const sessionConnections = pgTable(
	"session_connections",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		integrationId: uuid("integration_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_session_connections_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_session_connections_integration").using(
			"btree",
			table.integrationId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "session_connections_session_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.integrationId],
			foreignColumns: [integrations.id],
			name: "session_connections_integration_id_fkey",
		}).onDelete("cascade"),
		unique("session_connections_session_id_integration_id_key").on(
			table.sessionId,
			table.integrationId,
		),
	],
);

export const sessions = pgTable(
	"sessions",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		repoId: uuid("repo_id"),
		organizationId: text("organization_id").notNull(),
		createdBy: text("created_by"),
		sessionType: text("session_type").default("coding"),
		status: text().default("starting"),
		sandboxState: text("sandbox_state").default("provisioning").notNull(),
		agentState: text("agent_state").default("iterating").notNull(),
		terminalState: text("terminal_state"),
		stateReason: text("state_reason"),
		stateUpdatedAt: timestamp("state_updated_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
		sandboxId: text("sandbox_id"),
		snapshotId: text("snapshot_id"),
		branchName: text("branch_name"),
		baseCommitSha: text("base_commit_sha"),
		parentSessionId: uuid("parent_session_id"),
		initialPrompt: text("initial_prompt"),
		title: text(),
		titleStatus: text("title_status"),
		initialPromptSentAt: timestamp("initial_prompt_sent_at", { withTimezone: true, mode: "date" }),
		automationId: uuid("automation_id"),
		triggerId: uuid("trigger_id"),
		triggerEventId: uuid("trigger_event_id").references((): AnyPgColumn => triggerEvents.id, {
			onDelete: "set null",
		}),
		startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).defaultNow(),
		lastActivityAt: timestamp("last_activity_at", {
			withTimezone: true,
			mode: "date",
		}).defaultNow(),
		pausedAt: timestamp("paused_at", { withTimezone: true, mode: "date" }),
		endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
		idleTimeoutMinutes: integer("idle_timeout_minutes").default(30),
		autoDeleteDays: integer("auto_delete_days").default(7),
		source: text().default("web"),
		sandboxProvider: text("sandbox_provider").default("e2b").notNull(),
		origin: text().default("web"),
		localPathHash: text("local_path_hash"),
		sandboxUrl: text("sandbox_url"),
		codingAgentSessionId: text("coding_agent_session_id"),
		openCodeTunnelUrl: text("open_code_tunnel_url"),
		previewTunnelUrl: text("preview_tunnel_url"),
		agentConfig: jsonb("agent_config"),
		systemPrompt: text("system_prompt"),
		clientType: text("client_type"),
		clientMetadata: jsonb("client_metadata"),
		configurationId: uuid("configuration_id"),
		idempotencyKey: text("idempotency_key"),
		sandboxExpiresAt: timestamp("sandbox_expires_at", { withTimezone: true, mode: "date" }),
		meteredThroughAt: timestamp("metered_through_at", { withTimezone: true, mode: "date" }),
		lastSeenAliveAt: timestamp("last_seen_alive_at", { withTimezone: true, mode: "date" }),
		aliveCheckFailures: integer("alive_check_failures").default(0),
		pauseReason: text("pause_reason"),
		stopReason: text("stop_reason"),
		outcome: text("outcome"),
		summary: text("summary"),
		prUrls: jsonb("pr_urls"),
		metrics: jsonb("metrics"),
		latestTask: text("latest_task"),
		kind: text("kind"),
		runtimeStatus: text("runtime_status").default("starting").notNull(),
		operatorStatus: text("operator_status").default("active").notNull(),
		visibility: text("visibility").default("private").notNull(),
		workerId: uuid("worker_id").references((): AnyPgColumn => workers.id),
		workerRunId: uuid("worker_run_id").references((): AnyPgColumn => workerRuns.id),
		repoBaselineId: uuid("repo_baseline_id").references((): AnyPgColumn => repoBaselines.id),
		repoBaselineTargetId: uuid("repo_baseline_target_id").references(
			(): AnyPgColumn => repoBaselineTargets.id,
		),
		capabilitiesVersion: integer("capabilities_version").default(1).notNull(),
		continuedFromSessionId: uuid("continued_from_session_id"),
		rerunOfSessionId: uuid("rerun_of_session_id"),
		replacesSessionId: uuid("replaces_session_id"),
		replacedBySessionId: uuid("replaced_by_session_id"),
		lastVisibleUpdateAt: timestamp("last_visible_update_at", { withTimezone: true, mode: "date" }),
		outcomeJson: jsonb("outcome_json"),
		outcomeVersion: integer("outcome_version"),
		outcomePersistedAt: timestamp("outcome_persisted_at", { withTimezone: true, mode: "date" }),
		archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
		archivedBy: text("archived_by").references((): AnyPgColumn => user.id, {
			onDelete: "set null",
		}),
		deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
		deletedBy: text("deleted_by").references((): AnyPgColumn => user.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		index("idx_sessions_automation").using(
			"btree",
			table.automationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_sessions_client_type").using(
			"btree",
			table.clientType.asc().nullsLast().op("text_ops"),
		),
		index("idx_sessions_local_path_hash")
			.using("btree", table.localPathHash.asc().nullsLast().op("text_ops"))
			.where(sql`(local_path_hash IS NOT NULL)`),
		index("idx_sessions_org").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
		index("idx_sessions_parent").using(
			"btree",
			table.parentSessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_sessions_configuration").using(
			"btree",
			table.configurationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_sessions_repo").using("btree", table.repoId.asc().nullsLast().op("uuid_ops")),
		index("idx_sessions_sandbox_expires_at")
			.using("btree", table.sandboxExpiresAt.asc().nullsLast().op("timestamptz_ops"))
			.where(sql`(sandbox_expires_at IS NOT NULL)`),
		index("idx_sessions_sandbox_provider").using(
			"btree",
			table.sandboxProvider.asc().nullsLast().op("text_ops"),
		),
		index("idx_sessions_slack_lookup")
			.using(
				"btree",
				sql`((client_metadata ->> 'installationId'::text))`,
				sql`((client_metadata ->> 'channelId'::text))`,
				sql`((client_metadata ->> 'threadTs'::text))`,
			)
			.where(sql`(client_type = 'slack'::text)`),
		index("idx_sessions_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
		index("idx_sessions_trigger").using("btree", table.triggerId.asc().nullsLast().op("uuid_ops")),
		unique("idx_sessions_automation_trigger_event").on(table.automationId, table.triggerEventId),
		foreignKey({
			columns: [table.repoId],
			foreignColumns: [repos.id],
			name: "sessions_repo_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "sessions_organization_id_fkey",
		}),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "sessions_created_by_fkey",
		}),
		foreignKey({
			columns: [table.parentSessionId],
			foreignColumns: [table.id],
			name: "sessions_parent_session_id_fkey",
		}),
		foreignKey({
			columns: [table.continuedFromSessionId],
			foreignColumns: [table.id],
			name: "sessions_continued_from_session_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.rerunOfSessionId],
			foreignColumns: [table.id],
			name: "sessions_rerun_of_session_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.replacesSessionId],
			foreignColumns: [table.id],
			name: "sessions_replaces_session_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.replacedBySessionId],
			foreignColumns: [table.id],
			name: "sessions_replaced_by_session_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.automationId],
			foreignColumns: [automations.id],
			name: "sessions_automation_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.triggerId],
			foreignColumns: [triggers.id],
			name: "sessions_trigger_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.configurationId],
			foreignColumns: [configurations.id],
			name: "sessions_configuration_id_fkey",
		}).onDelete("cascade"),
		check(
			"sessions_sandbox_provider_check",
			sql`sandbox_provider = ANY (ARRAY['modal'::text, 'e2b'::text])`,
		),
		check(
			"sessions_kind_check",
			sql`kind IS NULL OR kind = ANY (ARRAY['manager'::text, 'task'::text, 'setup'::text])`,
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
			"sessions_visibility_v1_check",
			sql`visibility = ANY (ARRAY['private'::text, 'shared'::text, 'org'::text])`,
		),
		check(
			"sessions_manager_worker_run_null_check",
			sql`(kind != 'manager'::text) OR (worker_run_id IS NULL)`,
		),
		check(
			"sessions_manager_shape_check",
			sql`(kind != 'manager'::text) OR (worker_run_id IS NULL AND continued_from_session_id IS NULL AND rerun_of_session_id IS NULL)`,
		),
		check(
			"sessions_task_linkage_check",
			sql`(kind != 'task'::text) OR (configuration_id IS NULL) OR (repo_id IS NOT NULL AND repo_baseline_id IS NOT NULL AND repo_baseline_target_id IS NOT NULL)`,
		),
		check(
			"sessions_setup_requires_repo_check",
			sql`(kind != 'setup'::text) OR (repo_id IS NOT NULL)`,
		),
		index("idx_sessions_kind").using("btree", table.kind.asc().nullsLast().op("text_ops")),
		index("idx_sessions_runtime_status").using(
			"btree",
			table.runtimeStatus.asc().nullsLast().op("text_ops"),
		),
		index("idx_sessions_operator_status").using(
			"btree",
			table.operatorStatus.asc().nullsLast().op("text_ops"),
		),
		index("idx_sessions_worker").using("btree", table.workerId.asc().nullsLast().op("uuid_ops")),
		index("idx_sessions_worker_run").using(
			"btree",
			table.workerRunId.asc().nullsLast().op("uuid_ops"),
		),
		uniqueIndex("uq_sessions_one_active_setup_per_repo")
			.on(table.repoId)
			.where(sql`kind = 'setup' AND runtime_status NOT IN ('completed', 'failed', 'cancelled')`),
	],
);

export const sessionCapabilities = pgTable(
	"session_capabilities",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		capabilityKey: text("capability_key").notNull(),
		mode: text("mode").notNull().default("allow"),
		scope: jsonb("scope"),
		origin: text("origin"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_session_capabilities_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		unique("uq_session_capabilities_session_key").on(table.sessionId, table.capabilityKey),
		check(
			"session_capabilities_mode_check",
			sql`mode = ANY (ARRAY['allow'::text, 'require_approval'::text, 'deny'::text])`,
		),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "session_capabilities_session_id_fkey",
		}).onDelete("cascade"),
	],
);

export const sessionSkills = pgTable(
	"session_skills",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		skillKey: text("skill_key").notNull(),
		configJson: jsonb("config_json"),
		origin: text("origin"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_session_skills_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		unique("uq_session_skills_session_key").on(table.sessionId, table.skillKey),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "session_skills_session_id_fkey",
		}).onDelete("cascade"),
	],
);

export const sessionMessages = pgTable(
	"session_messages",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		direction: text("direction").notNull(),
		messageType: text("message_type").notNull(),
		payloadJson: jsonb("payload_json").notNull(),
		deliveryState: text("delivery_state").notNull().default("queued"),
		dedupeKey: text("dedupe_key"),
		queuedAt: timestamp("queued_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		deliverAfter: timestamp("deliver_after", { withTimezone: true, mode: "date" }),
		deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
		consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
		failedAt: timestamp("failed_at", { withTimezone: true, mode: "date" }),
		failureReason: text("failure_reason"),
		senderUserId: text("sender_user_id"),
		senderSessionId: uuid("sender_session_id"),
	},
	(table) => [
		index("idx_session_messages_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_session_messages_delivery_state").using(
			"btree",
			table.deliveryState.asc().nullsLast().op("text_ops"),
		),
		index("idx_session_messages_session_state").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
			table.deliveryState.asc().nullsLast().op("text_ops"),
		),
		uniqueIndex("uq_session_messages_dedupe")
			.on(table.sessionId, table.dedupeKey)
			.where(sql`dedupe_key IS NOT NULL`),
		check(
			"session_messages_direction_check",
			sql`direction = ANY (ARRAY['user_to_manager'::text, 'user_to_task'::text, 'manager_to_task'::text, 'task_to_manager'::text])`,
		),
		check(
			"session_messages_delivery_state_check",
			sql`delivery_state = ANY (ARRAY['queued'::text, 'delivered'::text, 'consumed'::text, 'failed'::text])`,
		),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "session_messages_session_id_fkey",
		}).onDelete("cascade"),
	],
);

export const sessionAcl = pgTable(
	"session_acl",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		userId: text("user_id").notNull(),
		role: text("role").notNull(),
		grantedBy: text("granted_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_session_acl_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_session_acl_user").using("btree", table.userId.asc().nullsLast().op("text_ops")),
		unique("uq_session_acl_session_user").on(table.sessionId, table.userId),
		check(
			"session_acl_role_check",
			sql`role = ANY (ARRAY['viewer'::text, 'editor'::text, 'reviewer'::text])`,
		),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "session_acl_session_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "session_acl_user_id_fkey",
		}).onDelete("cascade"),
	],
);

export const sessionUserState = pgTable(
	"session_user_state",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		userId: text("user_id").notNull(),
		lastViewedAt: timestamp("last_viewed_at", { withTimezone: true, mode: "date" }),
		archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_session_user_state_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_session_user_state_user").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
		),
		unique("uq_session_user_state_session_user").on(table.sessionId, table.userId),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "session_user_state_session_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "session_user_state_user_id_fkey",
		}).onDelete("cascade"),
	],
);

export const sessionEvents = pgTable(
	"session_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		eventType: text("event_type").notNull(),
		actorUserId: text("actor_user_id"),
		payloadJson: jsonb("payload_json"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_session_events_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_session_events_type").using(
			"btree",
			table.eventType.asc().nullsLast().op("text_ops"),
		),
		index("idx_session_events_chat_history").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
			table.eventType.asc().nullsLast().op("text_ops"),
			table.createdAt.asc().nullsLast(),
		),
		check(
			"session_events_type_check",
			sql`event_type = ANY (ARRAY['session_created'::text, 'session_started'::text, 'session_paused'::text, 'session_resumed'::text, 'session_completed'::text, 'session_failed'::text, 'session_cancelled'::text, 'session_outcome_persisted'::text, 'runtime_tool_started'::text, 'runtime_tool_finished'::text, 'runtime_approval_requested'::text, 'runtime_approval_resolved'::text, 'runtime_action_completed'::text, 'runtime_error'::text, 'chat_user_message'::text, 'chat_agent_response'::text, 'chat_job_tick'::text, 'chat_system'::text])`,
		),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "session_events_session_id_fkey",
		}).onDelete("cascade"),
	],
);

export const sessionPullRequests = pgTable(
	"session_pull_requests",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		repoId: uuid("repo_id").notNull(),
		branchName: text("branch_name").notNull(),
		provider: text("provider").notNull(),
		pullRequestNumber: integer("pull_request_number"),
		pullRequestUrl: text("pull_request_url"),
		pullRequestState: text("pull_request_state"),
		headCommitSha: text("head_commit_sha"),
		continuedFromSessionId: uuid("continued_from_session_id"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_session_pull_requests_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_session_pull_requests_repo").using(
			"btree",
			table.repoId.asc().nullsLast().op("uuid_ops"),
		),
		check(
			"session_pull_requests_state_check",
			sql`pull_request_state IS NULL OR pull_request_state = ANY (ARRAY['open'::text, 'closed'::text, 'merged'::text, 'draft'::text])`,
		),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "session_pull_requests_session_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.repoId],
			foreignColumns: [repos.id],
			name: "session_pull_requests_repo_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.continuedFromSessionId],
			foreignColumns: [sessions.id],
			name: "session_pull_requests_continued_from_session_id_fkey",
		}).onDelete("set null"),
	],
);

export const sessionConnectionsRelations = relations(sessionConnections, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionConnections.sessionId],
		references: [sessions.id],
	}),
	integration: one(integrations, {
		fields: [sessionConnections.integrationId],
		references: [integrations.id],
	}),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
	triggerEvents: many(triggerEvents, {
		relationName: "triggerEvents_sessionId_sessions_id",
	}),
	slackConversations: many(slackConversations),
	sessionConnections: many(sessionConnections),
	repo: one(repos, {
		fields: [sessions.repoId],
		references: [repos.id],
	}),
	organization: one(organization, {
		fields: [sessions.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [sessions.createdBy],
		references: [user.id],
	}),
	session: one(sessions, {
		fields: [sessions.parentSessionId],
		references: [sessions.id],
		relationName: "sessions_parentSessionId_sessions_id",
	}),
	sessions: many(sessions, {
		relationName: "sessions_parentSessionId_sessions_id",
	}),
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
		relationName: "sessions_triggerEventId_triggerEvents_id",
	}),
	configuration: one(configurations, {
		fields: [sessions.configurationId],
		references: [configurations.id],
	}),
	worker: one(workers, {
		fields: [sessions.workerId],
		references: [workers.id],
	}),
	workerRun: one(workerRuns, {
		fields: [sessions.workerRunId],
		references: [workerRuns.id],
	}),
	repoBaseline: one(repoBaselines, {
		fields: [sessions.repoBaselineId],
		references: [repoBaselines.id],
	}),
	repoBaselineTarget: one(repoBaselineTargets, {
		fields: [sessions.repoBaselineTargetId],
		references: [repoBaselineTargets.id],
	}),
	capabilities: many(sessionCapabilities),
	skills: many(sessionSkills),
	messages: many(sessionMessages),
	events: many(sessionEvents),
	acl: many(sessionAcl),
	userStates: many(sessionUserState),
	pullRequests: many(sessionPullRequests),
}));

export const sessionCapabilitiesRelations = relations(sessionCapabilities, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionCapabilities.sessionId],
		references: [sessions.id],
	}),
}));

export const sessionSkillsRelations = relations(sessionSkills, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionSkills.sessionId],
		references: [sessions.id],
	}),
}));

export const sessionMessagesRelations = relations(sessionMessages, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionMessages.sessionId],
		references: [sessions.id],
	}),
}));

export const sessionEventsRelations = relations(sessionEvents, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionEvents.sessionId],
		references: [sessions.id],
	}),
}));

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

import { automations } from "./automations";
import { integrations } from "./integrations";
import { slackConversations } from "./slack";
import { triggerEvents, triggers } from "./triggers";
import { workerRuns, workers } from "./workers";
