/**
 * Prebuilds schema
 */

import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { repos } from "./repos";

// ============================================
// Prebuilds
// ============================================

export const prebuilds = pgTable(
	"prebuilds",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		// Sandbox
		snapshotId: text("snapshot_id"), // NULL means prebuild is being set up
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

		// CLI prebuilds
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
		index("idx_prebuilds_repo_created").on(table.createdAt),
		index("idx_prebuilds_type_managed").on(table.type),
	],
);

export const prebuildsRelations = relations(prebuilds, ({ one, many }) => ({
	createdByUser: one(user, {
		fields: [prebuilds.createdBy],
		references: [user.id],
		relationName: "prebuildCreator",
	}),
	user: one(user, {
		fields: [prebuilds.userId],
		references: [user.id],
		relationName: "prebuildOwner",
	}),
	prebuildRepos: many(prebuildRepos),
	sessions: many(sessions),
	automations: many(automations),
}));

// ============================================
// Prebuild Repos (junction table)
// ============================================

export const prebuildRepos = pgTable(
	"prebuild_repos",
	{
		prebuildId: uuid("prebuild_id")
			.notNull()
			.references(() => prebuilds.id, { onDelete: "cascade" }),
		repoId: uuid("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
		workspacePath: text("workspace_path").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.prebuildId, table.repoId] }),
		index("idx_prebuild_repos_prebuild").on(table.prebuildId),
		index("idx_prebuild_repos_repo").on(table.repoId),
	],
);

export const prebuildReposRelations = relations(prebuildRepos, ({ one }) => ({
	prebuild: one(prebuilds, {
		fields: [prebuildRepos.prebuildId],
		references: [prebuilds.id],
	}),
	repo: one(repos, {
		fields: [prebuildRepos.repoId],
		references: [repos.id],
	}),
}));

import { automations } from "./automations";
// Forward declarations
import { sessions } from "./sessions";
