import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { repos } from "./repos";

export const configurations = pgTable(
	"configurations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		snapshotId: text("snapshot_id"),
		status: text().default("building"),
		error: text(),
		createdBy: text("created_by"),
		name: text().notNull(),
		notes: text(),
		routingDescription: text("routing_description"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		sandboxProvider: text("sandbox_provider").default("e2b").notNull(),
		userId: text("user_id"),
		localPathHash: text("local_path_hash"),
		type: text().default("manual"),
		serviceCommands: jsonb("service_commands"),
		serviceCommandsUpdatedAt: timestamp("service_commands_updated_at", {
			withTimezone: true,
			mode: "date",
		}),
		serviceCommandsUpdatedBy: text("service_commands_updated_by"),
		envFiles: jsonb("env_files"),
		envFilesUpdatedAt: timestamp("env_files_updated_at", {
			withTimezone: true,
			mode: "date",
		}),
		envFilesUpdatedBy: text("env_files_updated_by"),
		connectors: jsonb("connectors"),
		connectorsUpdatedAt: timestamp("connectors_updated_at", {
			withTimezone: true,
			mode: "date",
		}),
		connectorsUpdatedBy: text("connectors_updated_by"),
		refreshEnabled: boolean("refresh_enabled").default(false).notNull(),
		refreshIntervalMinutes: integer("refresh_interval_minutes").default(360).notNull(),
		lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true, mode: "date" }),
	},
	(table) => [
		index("idx_configurations_sandbox_provider").using(
			"btree",
			table.sandboxProvider.asc().nullsLast().op("text_ops"),
		),
		index("idx_configurations_type_managed")
			.using("btree", table.type.asc().nullsLast().op("text_ops"))
			.where(sql`(type = 'managed'::text)`),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "configurations_created_by_fkey",
		}),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "configurations_user_id_fkey",
		}).onDelete("cascade"),
		unique("configurations_user_path_unique").on(table.userId, table.localPathHash),
		check(
			"configurations_sandbox_provider_check",
			sql`sandbox_provider = ANY (ARRAY['modal'::text, 'e2b'::text])`,
		),
		check(
			"configurations_cli_requires_path",
			sql`((user_id IS NOT NULL) AND (local_path_hash IS NOT NULL)) OR ((user_id IS NULL) AND (local_path_hash IS NULL))`,
		),
	],
);

export const configurationRepos = pgTable(
	"configuration_repos",
	{
		configurationId: uuid("configuration_id").notNull(),
		repoId: uuid("repo_id").notNull(),
		workspacePath: text("workspace_path").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_configuration_repos_configuration").using(
			"btree",
			table.configurationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_configuration_repos_repo").using(
			"btree",
			table.repoId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.configurationId],
			foreignColumns: [configurations.id],
			name: "configuration_repos_configuration_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.repoId],
			foreignColumns: [repos.id],
			name: "configuration_repos_repo_id_fkey",
		}).onDelete("cascade"),
		primaryKey({
			columns: [table.configurationId, table.repoId],
			name: "configuration_repos_pkey",
		}),
	],
);

export const sandboxBaseSnapshots = pgTable(
	"sandbox_base_snapshots",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		versionKey: text("version_key").notNull(),
		snapshotId: text("snapshot_id"),
		status: text().default("building").notNull(),
		error: text(),
		provider: text().default("e2b").notNull(),
		modalAppName: text("modal_app_name").notNull(),
		builtAt: timestamp("built_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		uniqueIndex("idx_sandbox_base_snapshots_version_provider_app").using(
			"btree",
			table.versionKey.asc().nullsLast().op("text_ops"),
			table.provider.asc().nullsLast().op("text_ops"),
			table.modalAppName.asc().nullsLast().op("text_ops"),
		),
		index("idx_sandbox_base_snapshots_status").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
		),
		check(
			"sandbox_base_snapshots_status_check",
			sql`status = ANY (ARRAY['building'::text, 'ready'::text, 'failed'::text])`,
		),
	],
);

export const configurationsRelations = relations(configurations, ({ one, many }) => ({
	user_createdBy: one(user, {
		fields: [configurations.createdBy],
		references: [user.id],
		relationName: "configurations_createdBy_user_id",
	}),
	user_userId: one(user, {
		fields: [configurations.userId],
		references: [user.id],
		relationName: "configurations_userId_user_id",
	}),
	secrets: many(secrets),
	automations: many(automations),
	sessions: many(sessions),
	configurationRepos: many(configurationRepos),
	configurationSecrets: many(configurationSecrets),
	secretFiles: many(secretFiles),
}));

export const configurationReposRelations = relations(configurationRepos, ({ one }) => ({
	configuration: one(configurations, {
		fields: [configurationRepos.configurationId],
		references: [configurations.id],
	}),
	repo: one(repos, {
		fields: [configurationRepos.repoId],
		references: [repos.id],
	}),
}));

export const sandboxBaseSnapshotsRelations = relations(sandboxBaseSnapshots, () => ({}));

import { automations } from "./automations";
import { configurationSecrets, secretFiles, secrets } from "./secrets";
import { sessions } from "./sessions";
