/**
 * Secrets schema
 */

import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { repos } from "./repos";

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
	createdByUser: one(user, {
		fields: [secrets.createdBy],
		references: [user.id],
	}),
}));
