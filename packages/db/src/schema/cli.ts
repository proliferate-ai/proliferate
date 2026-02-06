/**
 * CLI schema - device codes, SSH keys, GitHub selections
 */

import { relations } from "drizzle-orm";
import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

// ============================================
// User SSH Keys
// ============================================

export const userSshKeys = pgTable(
	"user_ssh_keys",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		publicKey: text("public_key").notNull(),
		fingerprint: text("fingerprint").notNull().unique(),
		name: text("name"),

		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [index("idx_user_ssh_keys_user").on(table.userId)],
);

export const userSshKeysRelations = relations(userSshKeys, ({ one }) => ({
	user: one(user, {
		fields: [userSshKeys.userId],
		references: [user.id],
	}),
}));

// ============================================
// CLI Device Codes (OAuth Device Flow)
// ============================================

export const cliDeviceCodes = pgTable(
	"cli_device_codes",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		userCode: text("user_code").notNull().unique(),
		deviceCode: text("device_code").notNull().unique(),

		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		orgId: text("org_id").references(() => organization.id, { onDelete: "cascade" }),

		status: text("status").notNull().default("pending"), // 'pending', 'authorized', 'expired'

		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		authorizedAt: timestamp("authorized_at", { withTimezone: true }),
	},
	(table) => [
		index("idx_cli_device_codes_user_code").on(table.userCode),
		index("idx_cli_device_codes_device_code").on(table.deviceCode),
		index("idx_cli_device_codes_expires").on(table.expiresAt),
	],
);

export const cliDeviceCodesRelations = relations(cliDeviceCodes, ({ one }) => ({
	user: one(user, {
		fields: [cliDeviceCodes.userId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [cliDeviceCodes.orgId],
		references: [organization.id],
	}),
}));

// ============================================
// CLI GitHub Selections
// ============================================

export const cliGithubSelections = pgTable(
	"cli_github_selections",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		connectionId: text("connection_id").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.organizationId] }),
		index("idx_cli_github_selections_expires_at").on(table.expiresAt),
	],
);

export const cliGithubSelectionsRelations = relations(cliGithubSelections, ({ one }) => ({
	user: one(user, {
		fields: [cliGithubSelections.userId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [cliGithubSelections.organizationId],
		references: [organization.id],
	}),
}));
