import { relations, sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	check,
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const repos = pgTable(
	"repos",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		githubOrg: text("github_org").notNull(),
		githubName: text("github_name").notNull(),
		defaultSnapshotId: uuid("default_snapshot_id").references((): AnyPgColumn => repoSnapshots.id, {
			onDelete: "set null",
		}),
		connectionSource: text("connection_source").default("integration").notNull(),
		defaultBranch: text("default_branch").default("main").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("repos_organization_id_idx").on(table.organizationId),
		unique("repos_org_github_name_key").on(table.organizationId, table.githubOrg, table.githubName),
		check(
			"repos_connection_source_check",
			sql`connection_source = ANY (ARRAY['integration'::text, 'manual'::text])`,
		),
	],
);

export const repoSnapshots = pgTable(
	"repo_snapshots",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		repoId: uuid("repo_id")
			.notNull()
			.references((): AnyPgColumn => repos.id, { onDelete: "cascade" }),
		e2bSnapshotId: text("e2b_snapshot_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true, mode: "date" }),
		refreshFrequency: text("refresh_frequency"),
		updateCommands: text("update_commands").array(),
		setupCommands: text("setup_commands").array(),
	},
	(table) => [
		index("repo_snapshots_repo_id_idx").on(table.repoId),
		unique("repo_snapshots_e2b_snapshot_id_key").on(table.e2bSnapshotId),
	],
);

export const reposRelations = relations(repos, ({ one, many }) => ({
	organization: one(organization, {
		fields: [repos.organizationId],
		references: [organization.id],
	}),
	defaultSnapshot: one(repoSnapshots, {
		fields: [repos.defaultSnapshotId],
		references: [repoSnapshots.id],
	}),
	snapshots: many(repoSnapshots),
}));

export const repoSnapshotsRelations = relations(repoSnapshots, ({ one }) => ({
	repo: one(repos, {
		fields: [repoSnapshots.repoId],
		references: [repos.id],
	}),
}));
