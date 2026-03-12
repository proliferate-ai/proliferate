import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { repos } from "./repos";

export const integrations = pgTable(
	"integrations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		provider: text().notNull(),
		integrationId: text("integration_id").notNull(),
		connectionId: text("connection_id").notNull(),
		displayName: text("display_name"),
		scopes: text().array(),
		status: text().default("active"),
		visibility: text().default("org"),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
		githubInstallationId: text("github_installation_id"),
		encryptedAccessToken: text("encrypted_access_token"),
		encryptedRefreshToken: text("encrypted_refresh_token"),
		tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true, mode: "date" }),
		tokenType: text("token_type"),
		connectionMetadata: jsonb("connection_metadata"),
	},
	(table) => [
		index("idx_integrations_github_installation")
			.using("btree", table.githubInstallationId.asc().nullsLast().op("text_ops"))
			.where(sql`(github_installation_id IS NOT NULL)`),
		index("idx_integrations_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "integrations_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "integrations_created_by_fkey",
		}),
		unique("integrations_connection_id_key").on(table.connectionId),
		check(
			"integrations_visibility_check",
			sql`visibility = ANY (ARRAY['org'::text, 'private'::text])`,
		),
	],
);

export const repoConnections = pgTable(
	"repo_connections",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		repoId: uuid("repo_id").notNull(),
		integrationId: uuid("integration_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_repo_connections_integration").using(
			"btree",
			table.integrationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_repo_connections_repo").using(
			"btree",
			table.repoId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.repoId],
			foreignColumns: [repos.id],
			name: "repo_connections_repo_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.integrationId],
			foreignColumns: [integrations.id],
			name: "repo_connections_integration_id_fkey",
		}).onDelete("cascade"),
		unique("repo_connections_repo_id_integration_id_key").on(table.repoId, table.integrationId),
	],
);

export const orgConnectors = pgTable(
	"org_connectors",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		name: text().notNull(),
		transport: text().notNull().default("remote_http"),
		url: text().notNull(),
		auth: jsonb().notNull(),
		riskPolicy: jsonb("risk_policy"),
		toolRiskOverrides: jsonb("tool_risk_overrides"),
		enabled: boolean().notNull().default(true),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_org_connectors_org").on(table.organizationId),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "org_connectors_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "org_connectors_created_by_fkey",
		}),
	],
);

export const repoConnectionsRelations = relations(repoConnections, ({ one }) => ({
	repo: one(repos, {
		fields: [repoConnections.repoId],
		references: [repos.id],
	}),
	integration: one(integrations, {
		fields: [repoConnections.integrationId],
		references: [integrations.id],
	}),
}));

export const integrationsRelations = relations(integrations, ({ one, many }) => ({
	automationConnections: many(automationConnections),
	sessionConnections: many(sessionConnections),
	repoConnections: many(repoConnections),
	organization: one(organization, {
		fields: [integrations.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [integrations.createdBy],
		references: [user.id],
	}),
	triggers: many(triggers),
}));

export const orgConnectorsRelations = relations(orgConnectors, ({ one }) => ({
	organization: one(organization, {
		fields: [orgConnectors.organizationId],
		references: [organization.id],
	}),
	createdByUser: one(user, {
		fields: [orgConnectors.createdBy],
		references: [user.id],
	}),
}));

import { automationConnections } from "./automations";
import { sessionConnections } from "./sessions";
import { triggers } from "./triggers";
