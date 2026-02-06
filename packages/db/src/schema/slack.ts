/**
 * Slack integration schema
 */

import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { repos } from "./repos";
import { sessions } from "./sessions";

// ============================================
// Slack Installations
// ============================================

export const slackInstallations = pgTable(
	"slack_installations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Slack workspace info
		teamId: text("team_id").notNull(),
		teamName: text("team_name"),

		// Bot credentials (encrypted)
		encryptedBotToken: text("encrypted_bot_token").notNull(),
		botUserId: text("bot_user_id").notNull(),

		// Installation metadata
		scopes: text("scopes").array(),
		installedBy: text("installed_by").references(() => user.id),

		// Status
		status: text("status").default("active"),

		// Connect channel (for slash commands)
		connectChannelId: text("connect_channel_id"),

		// Invite URL
		inviteUrl: text("invite_url"),

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_slack_installations_org").on(table.organizationId),
		index("idx_slack_installations_team").on(table.teamId),
		unique("slack_installations_organization_id_team_id_key").on(
			table.organizationId,
			table.teamId,
		),
	],
);

export const slackInstallationsRelations = relations(slackInstallations, ({ one, many }) => ({
	organization: one(organization, {
		fields: [slackInstallations.organizationId],
		references: [organization.id],
	}),
	installedByUser: one(user, {
		fields: [slackInstallations.installedBy],
		references: [user.id],
	}),
	conversations: many(slackConversations),
}));

// ============================================
// Slack Conversations
// ============================================

export const slackConversations = pgTable(
	"slack_conversations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		slackInstallationId: uuid("slack_installation_id")
			.notNull()
			.references(() => slackInstallations.id, { onDelete: "cascade" }),

		// Slack thread identifiers
		channelId: text("channel_id").notNull(),
		threadTs: text("thread_ts").notNull(),

		// Linked session
		sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
		repoId: uuid("repo_id").references(() => repos.id),

		// Metadata
		startedBySlackUserId: text("started_by_slack_user_id"),

		// Status
		status: text("status").default("active"),

		// Pending prompt (for /proliferate new flow)
		pendingPrompt: text("pending_prompt"),

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_slack_conversations_installation").on(table.slackInstallationId),
		index("idx_slack_conversations_session").on(table.sessionId),
		index("idx_slack_conversations_thread").on(table.channelId, table.threadTs),
		unique("slack_conversations_slack_installation_id_channel_id_thread_ts_key").on(
			table.slackInstallationId,
			table.channelId,
			table.threadTs,
		),
	],
);

export const slackConversationsRelations = relations(slackConversations, ({ one }) => ({
	installation: one(slackInstallations, {
		fields: [slackConversations.slackInstallationId],
		references: [slackInstallations.id],
	}),
	session: one(sessions, {
		fields: [slackConversations.sessionId],
		references: [sessions.id],
	}),
	repo: one(repos, {
		fields: [slackConversations.repoId],
		references: [repos.id],
	}),
}));
