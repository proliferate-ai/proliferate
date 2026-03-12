import { relations, sql } from "drizzle-orm";
import {
	boolean,
	foreignKey,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const user = pgTable(
	"user",
	{
		id: text().primaryKey().notNull(),
		name: text().notNull(),
		email: text().notNull(),
		emailVerified: boolean().notNull(),
		image: text(),
		createdAt: timestamp({ withTimezone: true, mode: "date" })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		updatedAt: timestamp({ withTimezone: true, mode: "date" })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
	},
	(table) => [unique("user_email_key").on(table.email)],
);

export const session = pgTable(
	"session",
	{
		id: text().primaryKey().notNull(),
		expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
		token: text().notNull(),
		createdAt: timestamp({ withTimezone: true, mode: "date" })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
		ipAddress: text(),
		userAgent: text(),
		userId: text().notNull(),
		activeOrganizationId: text(),
	},
	(table) => [
		index("session_userId_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "session_userId_fkey",
		}).onDelete("cascade"),
		unique("session_token_key").on(table.token),
	],
);

export const account = pgTable(
	"account",
	{
		id: text().primaryKey().notNull(),
		accountId: text().notNull(),
		providerId: text().notNull(),
		userId: text().notNull(),
		accessToken: text(),
		refreshToken: text(),
		idToken: text(),
		accessTokenExpiresAt: timestamp({ withTimezone: true, mode: "date" }),
		refreshTokenExpiresAt: timestamp({ withTimezone: true, mode: "date" }),
		scope: text(),
		password: text(),
		createdAt: timestamp({ withTimezone: true, mode: "date" })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
	},
	(table) => [
		index("account_userId_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "account_userId_fkey",
		}).onDelete("cascade"),
	],
);

export const verification = pgTable(
	"verification",
	{
		id: text().primaryKey().notNull(),
		identifier: text().notNull(),
		value: text().notNull(),
		expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
		createdAt: timestamp({ withTimezone: true, mode: "date" })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		updatedAt: timestamp({ withTimezone: true, mode: "date" })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
	},
	(table) => [
		index("verification_identifier_idx").using(
			"btree",
			table.identifier.asc().nullsLast().op("text_ops"),
		),
	],
);

export const invitation = pgTable(
	"invitation",
	{
		id: text().primaryKey().notNull(),
		organizationId: text().notNull(),
		email: text().notNull(),
		role: text(),
		status: text().notNull(),
		expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
		createdAt: timestamp({ withTimezone: true, mode: "date" })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		inviterId: text().notNull(),
	},
	(table) => [
		index("invitation_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
		index("invitation_organizationId_idx").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "invitation_organizationId_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.inviterId],
			foreignColumns: [user.id],
			name: "invitation_inviterId_fkey",
		}).onDelete("cascade"),
	],
);

export const member = pgTable(
	"member",
	{
		id: text().primaryKey().notNull(),
		organizationId: text().notNull(),
		userId: text().notNull(),
		role: text().notNull(),
		createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
	},
	(table) => [
		index("member_organizationId_idx").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		index("member_userId_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "member_organizationId_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "member_userId_fkey",
		}).onDelete("cascade"),
	],
);

export const organization = pgTable(
	"organization",
	{
		id: text().primaryKey().notNull(),
		name: text().notNull(),
		slug: text().notNull(),
		logo: text(),
		createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
		metadata: text(),
		allowedDomains: text("allowed_domains").array(),
		isPersonal: boolean("is_personal").default(false),
		autumnCustomerId: text("autumn_customer_id"),
		billingSettings: jsonb("billing_settings").default({
			overage_policy: "pause",
			overage_cap_cents: null,
		}),
		onboardingComplete: boolean("onboarding_complete").default(false),
		billingState: text("billing_state").default("free").notNull(),
		billingPlan: text("billing_plan"),
		shadowBalance: numeric("shadow_balance", { precision: 12, scale: 6 }).default("0"),
		shadowBalanceUpdatedAt: timestamp("shadow_balance_updated_at", {
			withTimezone: true,
			mode: "date",
		}),
		graceEnteredAt: timestamp("grace_entered_at", { withTimezone: true, mode: "date" }),
		graceExpiresAt: timestamp("grace_expires_at", { withTimezone: true, mode: "date" }),
		onboardingMeta: jsonb("onboarding_meta"),
		actionModes: jsonb("action_modes"),
		overageUsedCents: integer("overage_used_cents").default(0).notNull(),
		overageCycleMonth: text("overage_cycle_month"),
		overageTopupCount: integer("overage_topup_count").default(0).notNull(),
		overageLastTopupAt: timestamp("overage_last_topup_at", {
			withTimezone: true,
			mode: "date",
		}),
		overageDeclineAt: timestamp("overage_decline_at", {
			withTimezone: true,
			mode: "date",
		}),
		lastReconciledAt: timestamp("last_reconciled_at", {
			withTimezone: true,
			mode: "date",
		}),
	},
	(table) => [
		index("organization_allowed_domains_idx").using(
			"gin",
			table.allowedDomains.asc().nullsLast().op("array_ops"),
		),
		index("organization_autumn_customer_idx")
			.using("btree", table.autumnCustomerId.asc().nullsLast().op("text_ops"))
			.where(sql`(autumn_customer_id IS NOT NULL)`),
		uniqueIndex("organization_slug_uidx").using(
			"btree",
			table.slug.asc().nullsLast().op("text_ops"),
		),
		unique("organization_slug_key").on(table.slug),
		index("organization_billing_state_idx").using(
			"btree",
			table.billingState.asc().nullsLast().op("text_ops"),
		),
	],
);

export const userSshKeys = pgTable(
	"user_ssh_keys",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		publicKey: text("public_key").notNull(),
		fingerprint: text().notNull(),
		name: text(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_user_ssh_keys_user").using("btree", table.userId.asc().nullsLast().op("text_ops")),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "user_ssh_keys_user_id_fkey",
		}).onDelete("cascade"),
		unique("user_ssh_keys_fingerprint_key").on(table.fingerprint),
	],
);

export const apikey = pgTable(
	"apikey",
	{
		id: text().primaryKey().notNull(),
		name: text(),
		start: text(),
		prefix: text(),
		key: text().notNull(),
		userId: text().notNull(),
		refillInterval: integer(),
		refillAmount: integer(),
		lastRefillAt: timestamp({ withTimezone: true, mode: "date" }),
		enabled: boolean(),
		rateLimitEnabled: boolean(),
		rateLimitTimeWindow: integer(),
		rateLimitMax: integer(),
		requestCount: integer(),
		remaining: integer(),
		lastRequest: timestamp({ withTimezone: true, mode: "date" }),
		expiresAt: timestamp({ withTimezone: true, mode: "date" }),
		createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
		updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
		permissions: text(),
		metadata: text(),
	},
	(table) => [
		index("apikey_key_idx").using("btree", table.key.asc().nullsLast().op("text_ops")),
		index("apikey_userId_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "apikey_userId_fkey",
		}).onDelete("cascade"),
	],
);

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id],
	}),
}));

export const userRelations = relations(user, ({ many }) => ({
	sessions_userId: many(session),
	accounts: many(account),
	invitations: many(invitation),
	members: many(member),
	repos: many(repos),
	configurations_createdBy: many(configurations, {
		relationName: "configurations_createdBy_user_id",
	}),
	configurations_userId: many(configurations, {
		relationName: "configurations_userId_user_id",
	}),
	integrations: many(integrations),
	secrets: many(secrets),
	triggers: many(triggers),
	automations: many(automations),
	schedules: many(schedules),
	userSshKeys: many(userSshKeys),
	apikeys: many(apikey),
	slackInstallations: many(slackInstallations),
	sessions_createdBy: many(sessions),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id],
	}),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
	organization: one(organization, {
		fields: [invitation.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [invitation.inviterId],
		references: [user.id],
	}),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
	invitations: many(invitation),
	members: many(member),
	repos: many(repos),
	integrations: many(integrations),
	secrets: many(secrets),
	triggers: many(triggers),
	automations: many(automations),
	schedules: many(schedules),
	triggerEvents: many(triggerEvents),
	automationRuns: many(automationRuns),
	outbox: many(outbox),
	slackInstallations: many(slackInstallations),
	sessions: many(sessions),
	billingEvents: many(billingEvents),
	orgConnectors: many(orgConnectors),
}));

export const memberRelations = relations(member, ({ one }) => ({
	organization: one(organization, {
		fields: [member.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [member.userId],
		references: [user.id],
	}),
}));

export const userSshKeysRelations = relations(userSshKeys, ({ one }) => ({
	user: one(user, {
		fields: [userSshKeys.userId],
		references: [user.id],
	}),
}));

export const apikeyRelations = relations(apikey, ({ one }) => ({
	user: one(user, {
		fields: [apikey.userId],
		references: [user.id],
	}),
}));

import { automationRuns, automations, outbox } from "./automations";
import { billingEvents } from "./billing";
import { configurations } from "./configurations";
import { integrations, orgConnectors } from "./integrations";
import { repos } from "./repos";
import { schedules } from "./schedules";
import { secrets } from "./secrets";
import { sessions } from "./sessions";
import { slackInstallations } from "./slack";
import { triggerEvents, triggers } from "./triggers";
