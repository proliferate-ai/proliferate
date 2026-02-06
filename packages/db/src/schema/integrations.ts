/**
 * Integrations schema
 */

import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { repos } from "./repos";

// ============================================
// Integrations
// ============================================

export const integrations = pgTable(
	"integrations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Provider
		provider: text("provider").notNull(), // 'nango', 'pipedream', 'github-app'

		// Provider-specific IDs
		integrationId: text("integration_id").notNull(), // 'notion', 'slack', 'github'
		connectionId: text("connection_id").notNull(),

		// Metadata
		displayName: text("display_name"),
		scopes: text("scopes").array(),
		status: text("status").default("active"), // 'active', 'expired', 'revoked'

		// Visibility
		visibility: text("visibility").default("org"), // 'org', 'private'

		// GitHub App specific
		githubInstallationId: text("github_installation_id"),

		createdBy: text("created_by").references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_integrations_org").on(table.organizationId),
		index("idx_integrations_github_installation").on(table.githubInstallationId),
		unique("integrations_connection_id_organization_id_key").on(
			table.connectionId,
			table.organizationId,
		),
	],
);

export const integrationsRelations = relations(integrations, ({ one, many }) => ({
	organization: one(organization, {
		fields: [integrations.organizationId],
		references: [organization.id],
	}),
	createdByUser: one(user, {
		fields: [integrations.createdBy],
		references: [user.id],
	}),
	repoConnections: many(repoConnections),
	triggers: many(triggers),
}));

// ============================================
// Repo Connections (junction table)
// ============================================

export const repoConnections = pgTable(
	"repo_connections",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		repoId: uuid("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
		integrationId: uuid("integration_id")
			.notNull()
			.references(() => integrations.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_repo_connections_repo").on(table.repoId),
		index("idx_repo_connections_integration").on(table.integrationId),
		unique("repo_connections_repo_id_integration_id_key").on(table.repoId, table.integrationId),
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

// Forward declaration
import { triggers } from "./triggers";
