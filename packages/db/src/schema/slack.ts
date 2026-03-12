import { relations, sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { configurations } from "./configurations";
import { repos } from "./repos";
import { sessions } from "./sessions";

export const slackInstallations = pgTable(
	"slack_installations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		teamId: text("team_id").notNull(),
		teamName: text("team_name"),
		encryptedBotToken: text("encrypted_bot_token").notNull(),
		botUserId: text("bot_user_id").notNull(),
		scopes: text().array(),
		installedBy: text("installed_by"),
		status: text().default("active"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
		supportChannelId: text("support_channel_id"),
		supportChannelName: text("support_channel_name"),
		supportInviteId: text("support_invite_id"),
		supportInviteUrl: text("support_invite_url"),
		defaultConfigSelectionStrategy: text("default_config_selection_strategy").default("fixed"),
		defaultConfigurationId: uuid("default_configuration_id"),
		fallbackConfigurationId: uuid("fallback_configuration_id"),
		allowedConfigurationIds: jsonb("allowed_configuration_ids"),
	},
	(table) => [
		index("idx_slack_installations_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		index("idx_slack_installations_team").using(
			"btree",
			table.teamId.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "slack_installations_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.installedBy],
			foreignColumns: [user.id],
			name: "slack_installations_installed_by_fkey",
		}),
		foreignKey({
			columns: [table.defaultConfigurationId],
			foreignColumns: [configurations.id],
			name: "slack_installations_default_configuration_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.fallbackConfigurationId],
			foreignColumns: [configurations.id],
			name: "slack_installations_fallback_configuration_id_fkey",
		}).onDelete("set null"),
		unique("slack_installations_organization_id_team_id_key").on(
			table.organizationId,
			table.teamId,
		),
	],
);

export const slackConversations = pgTable(
	"slack_conversations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		slackInstallationId: uuid("slack_installation_id").notNull(),
		channelId: text("channel_id").notNull(),
		threadTs: text("thread_ts").notNull(),
		sessionId: uuid("session_id"),
		repoId: uuid("repo_id"),
		startedBySlackUserId: text("started_by_slack_user_id"),
		status: text().default("active"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "date" }).defaultNow(),
		pendingPrompt: text("pending_prompt"),
	},
	(table) => [
		index("idx_slack_conversations_installation").using(
			"btree",
			table.slackInstallationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_slack_conversations_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_slack_conversations_thread").using(
			"btree",
			table.channelId.asc().nullsLast().op("text_ops"),
			table.threadTs.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.slackInstallationId],
			foreignColumns: [slackInstallations.id],
			name: "slack_conversations_slack_installation_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "slack_conversations_session_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.repoId],
			foreignColumns: [repos.id],
			name: "slack_conversations_repo_id_fkey",
		}),
		unique("slack_conversations_slack_installation_id_channel_id_thread_key").on(
			table.slackInstallationId,
			table.channelId,
			table.threadTs,
		),
	],
);

export const sessionNotificationSubscriptions = pgTable(
	"session_notification_subscriptions",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		userId: text("user_id").notNull(),
		slackInstallationId: uuid("slack_installation_id").notNull(),
		destinationType: text("destination_type").notNull().default("dm_user"),
		slackUserId: text("slack_user_id"),
		eventTypes: jsonb("event_types").default(["completed"]),
		notifiedAt: timestamp("notified_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_session_notif_sub_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_session_notif_sub_user").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "session_notification_subscriptions_session_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "session_notification_subscriptions_user_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.slackInstallationId],
			foreignColumns: [slackInstallations.id],
			name: "session_notification_subscriptions_slack_installation_id_fkey",
		}).onDelete("cascade"),
		unique("session_notification_subscriptions_session_user_key").on(table.sessionId, table.userId),
		check(
			"chk_session_notif_sub_dm_user_slack_id",
			sql`(destination_type != 'dm_user') OR (slack_user_id IS NOT NULL)`,
		),
	],
);

export const slackConversationsRelations = relations(slackConversations, ({ one }) => ({
	slackInstallation: one(slackInstallations, {
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

export const slackInstallationsRelations = relations(slackInstallations, ({ one, many }) => ({
	slackConversations: many(slackConversations),
	organization: one(organization, {
		fields: [slackInstallations.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [slackInstallations.installedBy],
		references: [user.id],
	}),
}));

export const sessionNotificationSubscriptionsRelations = relations(
	sessionNotificationSubscriptions,
	({ one }) => ({
		session: one(sessions, {
			fields: [sessionNotificationSubscriptions.sessionId],
			references: [sessions.id],
		}),
		user: one(user, {
			fields: [sessionNotificationSubscriptions.userId],
			references: [user.id],
		}),
		slackInstallation: one(slackInstallations, {
			fields: [sessionNotificationSubscriptions.slackInstallationId],
			references: [slackInstallations.id],
		}),
	}),
);
