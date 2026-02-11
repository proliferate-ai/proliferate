/**
 * Secrets schema
 */

import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { repos } from "./repos";

// ============================================
// Secret Bundles
// ============================================

export const secretBundles = pgTable(
	"secret_bundles",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		targetPath: text("target_path"),
		createdBy: text("created_by").references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_secret_bundles_org").on(table.organizationId),
		unique("secret_bundles_org_name_unique").on(table.organizationId, table.name),
	],
);

export const secretBundlesRelations = relations(secretBundles, ({ one, many }) => ({
	organization: one(organization, {
		fields: [secretBundles.organizationId],
		references: [organization.id],
	}),
	createdByUser: one(user, {
		fields: [secretBundles.createdBy],
		references: [user.id],
	}),
	secrets: many(secrets),
}));

// ============================================
// Secrets
// ============================================

export const secrets = pgTable(
	"secrets",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		repoId: uuid("repo_id").references(() => repos.id, { onDelete: "cascade" }), // null = org-wide
		bundleId: uuid("bundle_id").references(() => secretBundles.id, { onDelete: "set null" }), // null = unbundled

		key: text("key").notNull(),
		encryptedValue: text("encrypted_value").notNull(),
		secretType: text("secret_type").default("env"), // 'env', 'docker_registry', 'file'
		description: text("description"),

		createdBy: text("created_by").references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_secrets_org").on(table.organizationId),
		index("idx_secrets_repo").on(table.repoId),
		index("idx_secrets_bundle").on(table.bundleId),
		unique("secrets_organization_id_repo_id_key_key").on(
			table.organizationId,
			table.repoId,
			table.key,
		),
	],
);

export const secretsRelations = relations(secrets, ({ one }) => ({
	organization: one(organization, {
		fields: [secrets.organizationId],
		references: [organization.id],
	}),
	repo: one(repos, {
		fields: [secrets.repoId],
		references: [repos.id],
	}),
	bundle: one(secretBundles, {
		fields: [secrets.bundleId],
		references: [secretBundles.id],
	}),
	createdByUser: one(user, {
		fields: [secrets.createdBy],
		references: [user.id],
	}),
}));
