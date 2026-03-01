/**
 * Repos schema — includes V1 repo_baselines and repo_baseline_targets.
 */

import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import {
	boolean,
	check,
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
	baselines: many(repoBaselines),
	workspaceCacheSnapshots: many(workspaceCacheSnapshots),
}));

// ============================================
// Repo Baselines (V1)
// ============================================

export const repoBaselines = pgTable(
	"repo_baselines",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		repoId: uuid("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Status: validating | ready | stale | failed
		status: text("status").notNull().default("validating"),

		// Baseline version (monotonic per repo)
		version: text("version"),

		// Snapshot/image reference
		snapshotId: text("snapshot_id"),
		sandboxProvider: text("sandbox_provider"),

		// Setup session that validated this baseline
		setupSessionId: uuid("setup_session_id").references(() => sessions.id, {
			onDelete: "set null",
		}),

		// Recipes
		installCommands: jsonb("install_commands"),
		runCommands: jsonb("run_commands"),
		testCommands: jsonb("test_commands"),
		serviceCommands: jsonb("service_commands"),

		// Error info
		errorMessage: text("error_message"),

		createdBy: text("created_by").references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_repo_baselines_repo").on(table.repoId),

		// One active baseline per repo (status = 'ready')
		uniqueIndex("uq_repo_baselines_one_active_per_repo")
			.on(table.repoId)
			.where(sql`status = 'ready'`),
		check(
			"repo_baselines_status_check",
			sql`status = ANY (ARRAY['validating'::text, 'ready'::text, 'stale'::text, 'failed'::text])`,
		),
	],
);

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
	workspaceCacheSnapshots: many(workspaceCacheSnapshots),
}));

// ============================================
// Repo Baseline Targets (V1)
// ============================================

export const repoBaselineTargets = pgTable(
	"repo_baseline_targets",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		repoBaselineId: uuid("repo_baseline_id")
			.notNull()
			.references(() => repoBaselines.id, { onDelete: "cascade" }),

		// Target identity
		name: text("name").notNull(),
		description: text("description"),

		// Target-specific config overrides
		configJson: jsonb("config_json"),

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("idx_repo_baseline_targets_baseline").on(table.repoBaselineId)],
);

export const repoBaselineTargetsRelations = relations(repoBaselineTargets, ({ one }) => ({
	baseline: one(repoBaselines, {
		fields: [repoBaselineTargets.repoBaselineId],
		references: [repoBaselines.id],
	}),
}));

// ============================================
// Workspace Cache Snapshots (V1 optimization-only)
// ============================================

export const workspaceCacheSnapshots = pgTable(
	"workspace_cache_snapshots",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		repoId: uuid("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
		repoBaselineId: uuid("repo_baseline_id").references(() => repoBaselines.id, {
			onDelete: "set null",
		}),
		repoBaselineTargetId: uuid("repo_baseline_target_id").references(() => repoBaselineTargets.id, {
			onDelete: "set null",
		}),
		cacheKey: text("cache_key").notNull(),
		snapshotId: text("snapshot_id").notNull(),
		sandboxProvider: text("sandbox_provider"),
		metadataJson: jsonb("metadata_json"),
		createdBy: text("created_by").references(() => user.id),
		lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_workspace_cache_snapshots_org").on(table.organizationId),
		index("idx_workspace_cache_snapshots_repo").on(table.repoId),
		index("idx_workspace_cache_snapshots_baseline").on(table.repoBaselineId),
		index("idx_workspace_cache_snapshots_baseline_target").on(table.repoBaselineTargetId),
		unique("uq_workspace_cache_snapshots_cache_key").on(table.cacheKey),
	],
);

export const workspaceCacheSnapshotsRelations = relations(workspaceCacheSnapshots, ({ one }) => ({
	organization: one(organization, {
		fields: [workspaceCacheSnapshots.organizationId],
		references: [organization.id],
	}),
	repo: one(repos, {
		fields: [workspaceCacheSnapshots.repoId],
		references: [repos.id],
	}),
	repoBaseline: one(repoBaselines, {
		fields: [workspaceCacheSnapshots.repoBaselineId],
		references: [repoBaselines.id],
	}),
	repoBaselineTarget: one(repoBaselineTargets, {
		fields: [workspaceCacheSnapshots.repoBaselineTargetId],
		references: [repoBaselineTargets.id],
	}),
	createdByUser: one(user, {
		fields: [workspaceCacheSnapshots.createdBy],
		references: [user.id],
	}),
}));

import { configurationRepos } from "./configurations";
import { repoConnections } from "./integrations";
// Forward declarations for circular references
import { secrets } from "./secrets";
import { sessions } from "./sessions";
