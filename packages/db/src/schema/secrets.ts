import { relations } from "drizzle-orm";
import {
	foreignKey,
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { configurations } from "./configurations";
import { repos } from "./repos";

export const secrets = pgTable(
	"secrets",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		repoId: uuid("repo_id"),
		key: text().notNull(),
		encryptedValue: text("encrypted_value").notNull(),
		secretType: text("secret_type").default("env"),
		description: text(),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
		configurationId: uuid("configuration_id"),
	},
	(table) => [
		index("idx_secrets_org").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
		index("idx_secrets_repo").using("btree", table.repoId.asc().nullsLast().op("uuid_ops")),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "secrets_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.repoId],
			foreignColumns: [repos.id],
			name: "secrets_repo_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "secrets_created_by_fkey",
		}),
		foreignKey({
			columns: [table.configurationId],
			foreignColumns: [configurations.id],
			name: "secrets_configuration_id_fkey",
		}).onDelete("cascade"),
		unique("secrets_org_repo_configuration_key_unique").on(
			table.organizationId,
			table.repoId,
			table.key,
			table.configurationId,
		),
	],
);

export const secretFiles = pgTable(
	"secret_files",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		configurationId: uuid("configuration_id"),
		filePath: text("file_path").notNull(),
		encryptedContent: text("encrypted_content").notNull(),
		description: text(),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_secret_files_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		index("idx_secret_files_configuration").using(
			"btree",
			table.configurationId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "secret_files_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.configurationId],
			foreignColumns: [configurations.id],
			name: "secret_files_configuration_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "secret_files_created_by_fkey",
		}),
		unique("secret_files_org_config_path_unique").on(
			table.organizationId,
			table.configurationId,
			table.filePath,
		),
	],
);

export const configurationSecrets = pgTable(
	"configuration_secrets",
	{
		configurationId: uuid("configuration_id").notNull(),
		secretId: uuid("secret_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_configuration_secrets_configuration").using(
			"btree",
			table.configurationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_configuration_secrets_secret").using(
			"btree",
			table.secretId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.configurationId],
			foreignColumns: [configurations.id],
			name: "configuration_secrets_configuration_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.secretId],
			foreignColumns: [secrets.id],
			name: "configuration_secrets_secret_id_fkey",
		}).onDelete("cascade"),
		primaryKey({
			columns: [table.configurationId, table.secretId],
			name: "configuration_secrets_pkey",
		}),
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
	user: one(user, {
		fields: [secrets.createdBy],
		references: [user.id],
	}),
	configuration: one(configurations, {
		fields: [secrets.configurationId],
		references: [configurations.id],
	}),
}));

export const secretFilesRelations = relations(secretFiles, ({ one }) => ({
	organization: one(organization, {
		fields: [secretFiles.organizationId],
		references: [organization.id],
	}),
	configuration: one(configurations, {
		fields: [secretFiles.configurationId],
		references: [configurations.id],
	}),
	user: one(user, {
		fields: [secretFiles.createdBy],
		references: [user.id],
	}),
}));

export const configurationSecretsRelations = relations(configurationSecrets, ({ one }) => ({
	configuration: one(configurations, {
		fields: [configurationSecrets.configurationId],
		references: [configurations.id],
	}),
	secret: one(secrets, {
		fields: [configurationSecrets.secretId],
		references: [secrets.id],
	}),
}));
