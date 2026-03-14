import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { repos } from "./repos";

export const secrets = pgTable(
	"secrets",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		key: text().notNull(),
		encryptedValue: text("encrypted_value").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("secrets_organization_id_idx").on(table.organizationId),
		unique("secrets_org_key_key").on(table.organizationId, table.key),
	],
);

export const repoSecrets = pgTable(
	"repo_secrets",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		secretId: uuid("secret_id")
			.notNull()
			.references(() => secrets.id, { onDelete: "cascade" }),
		repoId: uuid("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("repo_secrets_secret_id_idx").on(table.secretId),
		index("repo_secrets_repo_id_idx").on(table.repoId),
		unique("repo_secrets_secret_id_repo_id_key").on(table.secretId, table.repoId),
	],
);

export const secretsRelations = relations(secrets, ({ one, many }) => ({
	organization: one(organization, {
		fields: [secrets.organizationId],
		references: [organization.id],
	}),
	repoBindings: many(repoSecrets),
}));

export const repoSecretsRelations = relations(repoSecrets, ({ one }) => ({
	secret: one(secrets, {
		fields: [repoSecrets.secretId],
		references: [secrets.id],
	}),
	repo: one(repos, {
		fields: [repoSecrets.repoId],
		references: [repos.id],
	}),
}));
