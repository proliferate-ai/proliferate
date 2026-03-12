import { relations, sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	check,
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

export const repos = pgTable(
	"repos",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		githubUrl: text("github_url").notNull(),
		githubRepoId: text("github_repo_id").notNull(),
		githubRepoName: text("github_repo_name").notNull(),
		defaultBranch: text("default_branch").default("main"),
		setupCommands: text("setup_commands").array(),
		detectedStack: jsonb("detected_stack"),
		isOrphaned: boolean("is_orphaned").default(false),
		addedBy: text("added_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
		source: text().default("github"),
		isPrivate: boolean("is_private").default(false),
		localPathHash: text("local_path_hash"),
		repoSnapshotId: text("repo_snapshot_id"),
		repoSnapshotStatus: text("repo_snapshot_status"),
		repoSnapshotError: text("repo_snapshot_error"),
		repoSnapshotCommitSha: text("repo_snapshot_commit_sha"),
		repoSnapshotBuiltAt: timestamp("repo_snapshot_built_at", { withTimezone: true, mode: "date" }),
		repoSnapshotProvider: text("repo_snapshot_provider"),
		serviceCommands: jsonb("service_commands"),
		serviceCommandsUpdatedAt: timestamp("service_commands_updated_at", {
			withTimezone: true,
			mode: "date",
		}),
		serviceCommandsUpdatedBy: text("service_commands_updated_by"),
	},
	(table) => [
		index("idx_repos_local_path_hash")
			.using("btree", table.localPathHash.asc().nullsLast().op("text_ops"))
			.where(sql`(local_path_hash IS NOT NULL)`),
		index("idx_repos_org").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
		index("idx_repos_repo_snapshot_status").using(
			"btree",
			table.repoSnapshotStatus.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "repos_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.addedBy],
			foreignColumns: [user.id],
			name: "repos_added_by_fkey",
		}),
		unique("repos_organization_id_github_repo_id_key").on(table.organizationId, table.githubRepoId),
		check(
			"repos_source_check",
			sql`((source = 'local'::text) AND (local_path_hash IS NOT NULL)) OR (source <> 'local'::text)`,
		),
	],
);

export const repoBaselines = pgTable(
	"repo_baselines",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		repoId: uuid("repo_id").notNull(),
		organizationId: text("organization_id").notNull(),
		status: text("status").notNull().default("validating"),
		version: text("version"),
		snapshotId: text("snapshot_id"),
		sandboxProvider: text("sandbox_provider"),
		setupSessionId: uuid("setup_session_id").references((): AnyPgColumn => sessions.id, {
			onDelete: "set null",
		}),
		installCommands: jsonb("install_commands"),
		runCommands: jsonb("run_commands"),
		testCommands: jsonb("test_commands"),
		serviceCommands: jsonb("service_commands"),
		errorMessage: text("error_message"),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_repo_baselines_repo").using("btree", table.repoId.asc().nullsLast().op("uuid_ops")),
		uniqueIndex("uq_repo_baselines_one_active_per_repo")
			.on(table.repoId)
			.where(sql`status = 'ready'`),
		check(
			"repo_baselines_status_check",
			sql`status = ANY (ARRAY['validating'::text, 'ready'::text, 'stale'::text, 'failed'::text])`,
		),
		foreignKey({
			columns: [table.repoId],
			foreignColumns: [repos.id],
			name: "repo_baselines_repo_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "repo_baselines_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "repo_baselines_created_by_fkey",
		}),
	],
);

export const repoBaselineTargets = pgTable(
	"repo_baseline_targets",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		repoBaselineId: uuid("repo_baseline_id").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		configJson: jsonb("config_json"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_repo_baseline_targets_baseline").using(
			"btree",
			table.repoBaselineId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.repoBaselineId],
			foreignColumns: [repoBaselines.id],
			name: "repo_baseline_targets_repo_baseline_id_fkey",
		}).onDelete("cascade"),
	],
);

export const reposRelations = relations(repos, ({ one, many }) => ({
	organization: one(organization, {
		fields: [repos.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [repos.addedBy],
		references: [user.id],
	}),
	repoConnections: many(repoConnections),
	secrets: many(secrets),
	slackConversations: many(slackConversations),
	sessions: many(sessions),
	configurationRepos: many(configurationRepos),
	repoBaselines: many(repoBaselines),
}));

export const repoBaselinesRelations = relations(repoBaselines, ({ one, many }) => ({
	repo: one(repos, {
		fields: [repoBaselines.repoId],
		references: [repos.id],
	}),
	organization: one(organization, {
		fields: [repoBaselines.organizationId],
		references: [organization.id],
	}),
	targets: many(repoBaselineTargets),
}));

export const repoBaselineTargetsRelations = relations(repoBaselineTargets, ({ one }) => ({
	baseline: one(repoBaselines, {
		fields: [repoBaselineTargets.repoBaselineId],
		references: [repoBaselines.id],
	}),
}));

import { configurationRepos } from "./configurations";
import { repoConnections } from "./integrations";
import { secrets } from "./secrets";
import { sessions } from "./sessions";
import { slackConversations } from "./slack";
