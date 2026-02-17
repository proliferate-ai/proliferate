/**
 * Configurations schema
 */

import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { repos } from "./repos";

// ============================================
// Configurations
// ============================================

export const configurations = pgTable(
	"configurations",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		// Sandbox
		snapshotId: text("snapshot_id"), // NULL means configuration is being set up
		sandboxProvider: text("sandbox_provider").default("modal"),

		// Status
		status: text("status").default("building"), // 'building', 'ready', 'failed'
		error: text("error"),

		// Type
		type: text("type").default("manual"), // 'manual', 'managed'

		// Metadata
		createdBy: text("created_by").references(() => user.id),
		name: text("name").notNull(),
		notes: text("notes"),

		// CLI configurations
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		localPathHash: text("local_path_hash"),

		// Auto-start service commands
		serviceCommands: jsonb("service_commands"),
		serviceCommandsUpdatedAt: timestamp("service_commands_updated_at", {
			withTimezone: true,
		}),
		serviceCommandsUpdatedBy: text("service_commands_updated_by"),

		// Env file generation spec
		envFiles: jsonb("env_files"),
		envFilesUpdatedAt: timestamp("env_files_updated_at", {
			withTimezone: true,
		}),
		envFilesUpdatedBy: text("env_files_updated_by"),

		// MCP connector configs
		connectors: jsonb("connectors"),
		connectorsUpdatedAt: timestamp("connectors_updated_at", {
			withTimezone: true,
		}),
		connectorsUpdatedBy: text("connectors_updated_by"),

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_configurations_repo_created").on(table.createdAt),
		index("idx_configurations_type_managed").on(table.type),
	],
);

export const configurationsRelations = relations(configurations, ({ one, many }) => ({
	createdByUser: one(user, {
		fields: [configurations.createdBy],
		references: [user.id],
		relationName: "configurationCreator",
	}),
	user: one(user, {
		fields: [configurations.userId],
		references: [user.id],
		relationName: "configurationOwner",
	}),
	configurationRepos: many(configurationRepos),
	sessions: many(sessions),
	automations: many(automations),
}));

// ============================================
// Configuration Repos (junction table)
// ============================================

export const configurationRepos = pgTable(
	"configuration_repos",
	{
		configurationId: uuid("configuration_id")
			.notNull()
			.references(() => configurations.id, { onDelete: "cascade" }),
		repoId: uuid("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
		workspacePath: text("workspace_path").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.configurationId, table.repoId] }),
		index("idx_configuration_repos_configuration").on(table.configurationId),
		index("idx_configuration_repos_repo").on(table.repoId),
	],
);

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

import { automations } from "./automations";
// Forward declarations
import { sessions } from "./sessions";
