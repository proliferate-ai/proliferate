/**
 * Sessions schema
 */

import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { prebuilds } from "./prebuilds";
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

		// Type
		sessionType: text("session_type").default("coding"), // 'setup', 'coding', 'terminal'

		// Status
		status: text("status").default("starting"), // 'starting', 'running', 'paused', 'stopped', 'failed'

		// Sandbox
		sandboxId: text("sandbox_id"),
		sandboxProvider: text("sandbox_provider").default("modal"),
		snapshotId: text("snapshot_id"),

		// Prebuild reference
		prebuildId: uuid("prebuild_id").references(() => prebuilds.id, {
			onDelete: "set null",
		}),

		// Git
		branchName: text("branch_name"),
		baseCommitSha: text("base_commit_sha"),

		// Parent session
		parentSessionId: uuid("parent_session_id"),
		initialPrompt: text("initial_prompt"),

		// Display
		title: text("title"),

		// Automation/Trigger linkage
		automationId: uuid("automation_id"), // FK added separately
		triggerId: uuid("trigger_id"), // FK added separately
		triggerEventId: uuid("trigger_event_id"), // FK added separately

		// Timestamps
		startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
		lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow(),
		pausedAt: timestamp("paused_at", { withTimezone: true }),
		endedAt: timestamp("ended_at", { withTimezone: true }),

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
		billingTokenVersion: integer("billing_token_version").default(1),
		lastSeenAliveAt: timestamp("last_seen_alive_at", { withTimezone: true }),
		aliveCheckFailures: integer("alive_check_failures").default(0),
		pauseReason: text("pause_reason"),
		stopReason: text("stop_reason"),

		// Sandbox lifecycle
		sandboxExpiresAt: timestamp("sandbox_expires_at", { withTimezone: true }),

		// Source (for session tracking)
		source: text("source"),
	},
	(table) => [
		index("idx_sessions_org").on(table.organizationId),
		index("idx_sessions_repo").on(table.repoId),
		index("idx_sessions_status").on(table.status),
		index("idx_sessions_parent").on(table.parentSessionId),
		index("idx_sessions_automation").on(table.automationId),
		index("idx_sessions_trigger").on(table.triggerId),
		index("idx_sessions_prebuild").on(table.prebuildId),
		index("idx_sessions_local_path_hash").on(table.localPathHash),
		index("idx_sessions_client_type").on(table.clientType),
		index("idx_sessions_sandbox_expires_at").on(table.sandboxExpiresAt),
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
	prebuild: one(prebuilds, {
		fields: [sessions.prebuildId],
		references: [prebuilds.id],
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
}));

// Forward declarations
import { automations } from "./automations";
import { slackConversations } from "./slack";
import { triggerEvents, triggers } from "./triggers";
