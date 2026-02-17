/**
 * Repos schema
 */

import { relations } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

// ============================================
// Repos
// ============================================

export const repos = pgTable(
	"repos",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// GitHub metadata
		githubUrl: text("github_url").notNull(),
		githubRepoId: text("github_repo_id").notNull(),
		githubRepoName: text("github_repo_name").notNull(),
		defaultBranch: text("default_branch").default("main"),

		// Setup metadata
		setupCommands: text("setup_commands").array(),
		detectedStack: jsonb("detected_stack"),

		// Multi-connection support
		isOrphaned: boolean("is_orphaned").default(false),
		addedBy: text("added_by").references(() => user.id),

		// Source (github or local for CLI)
		source: text("source").default("github"),
		localPathHash: text("local_path_hash"),

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_repos_org").on(table.organizationId),
		index("idx_repos_local_path_hash").on(table.localPathHash),
		unique("repos_organization_id_github_repo_id_key").on(table.organizationId, table.githubRepoId),
	],
);

export const reposRelations = relations(repos, ({ one, many }) => ({
	organization: one(organization, {
		fields: [repos.organizationId],
		references: [organization.id],
	}),
	addedByUser: one(user, {
		fields: [repos.addedBy],
		references: [user.id],
	}),
	configurationRepos: many(configurationRepos),
	repoConnections: many(repoConnections),
	secrets: many(secrets),
}));

import { configurationRepos } from "./configurations";
import { repoConnections } from "./integrations";
// Forward declarations for circular references
import { secrets } from "./secrets";
