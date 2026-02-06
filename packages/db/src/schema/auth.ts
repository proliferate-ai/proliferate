/**
 * Auth schema - better-auth managed tables
 */

import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================
// User
// ============================================

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("emailVerified").notNull(),
	image: text("image"),
	createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export const userRelations = relations(user, ({ many }) => ({
	sessions: many(authSession),
	accounts: many(account),
	members: many(member),
	apiKeys: many(apikey),
}));

// ============================================
// Auth Session (better-auth sessions, not app sessions)
// ============================================

export const authSession = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
		ipAddress: text("ipAddress"),
		userAgent: text("userAgent"),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		activeOrganizationId: text("activeOrganizationId"),
	},
	(table) => [index("session_userId_idx").on(table.userId)],
);

export const authSessionRelations = relations(authSession, ({ one }) => ({
	user: one(user, {
		fields: [authSession.userId],
		references: [user.id],
	}),
}));

// ============================================
// Account
// ============================================

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("accountId").notNull(),
		providerId: text("providerId").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("accessToken"),
		refreshToken: text("refreshToken"),
		idToken: text("idToken"),
		accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }),
		refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id],
	}),
}));

// ============================================
// Verification
// ============================================

export const verification = pgTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
		createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

// ============================================
// Organization
// ============================================

export const organization = pgTable(
	"organization",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		slug: text("slug").notNull().unique(),
		logo: text("logo"),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
		metadata: text("metadata"),
		// Custom columns
		allowedDomains: text("allowed_domains").array(),
		isPersonal: boolean("is_personal").default(false),
		autumnCustomerId: text("autumn_customer_id"),
		billingSettings: text("billing_settings"), // JSONB stored as text for better-auth compat
		onboardingComplete: boolean("onboarding_complete").default(false),
		// Billing V2 fields
		billingState: text("billing_state").default("unconfigured").notNull(),
		billingPlan: text("billing_plan"),
		shadowBalance: numeric("shadow_balance", { precision: 12, scale: 6 }).default("0"),
		shadowBalanceUpdatedAt: timestamp("shadow_balance_updated_at", { withTimezone: true }),
		graceEnteredAt: timestamp("grace_entered_at", { withTimezone: true }),
		graceExpiresAt: timestamp("grace_expires_at", { withTimezone: true }),
	},
	(table) => [uniqueIndex("organization_slug_uidx").on(table.slug)],
);

export const organizationRelations = relations(organization, ({ many }) => ({
	members: many(member),
	invitations: many(invitation),
}));

// ============================================
// Member
// ============================================

export const member = pgTable(
	"member",
	{
		id: text("id").primaryKey(),
		organizationId: text("organizationId")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
	},
	(table) => [
		index("member_organizationId_idx").on(table.organizationId),
		index("member_userId_idx").on(table.userId),
	],
);

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

// ============================================
// Invitation
// ============================================

export const invitation = pgTable(
	"invitation",
	{
		id: text("id").primaryKey(),
		organizationId: text("organizationId")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		role: text("role"),
		status: text("status").notNull(),
		expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
		createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
		inviterId: text("inviterId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("invitation_organizationId_idx").on(table.organizationId),
		index("invitation_email_idx").on(table.email),
	],
);

export const invitationRelations = relations(invitation, ({ one }) => ({
	organization: one(organization, {
		fields: [invitation.organizationId],
		references: [organization.id],
	}),
	inviter: one(user, {
		fields: [invitation.inviterId],
		references: [user.id],
	}),
}));

// ============================================
// API Key (better-auth apiKey plugin)
// ============================================

export const apikey = pgTable(
	"apikey",
	{
		id: text("id").primaryKey(),
		name: text("name"),
		start: text("start"),
		prefix: text("prefix"),
		key: text("key").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		refillInterval: integer("refillInterval"),
		refillAmount: integer("refillAmount"),
		lastRefillAt: timestamp("lastRefillAt", { withTimezone: true }),
		enabled: boolean("enabled"),
		rateLimitEnabled: boolean("rateLimitEnabled"),
		rateLimitTimeWindow: integer("rateLimitTimeWindow"),
		rateLimitMax: integer("rateLimitMax"),
		requestCount: integer("requestCount"),
		remaining: integer("remaining"),
		lastRequest: timestamp("lastRequest", { withTimezone: true }),
		expiresAt: timestamp("expiresAt", { withTimezone: true }),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
		permissions: text("permissions"),
		metadata: text("metadata"),
	},
	(table) => [index("apikey_key_idx").on(table.key), index("apikey_userId_idx").on(table.userId)],
);

export const apikeyRelations = relations(apikey, ({ one }) => ({
	user: one(user, {
		fields: [apikey.userId],
		references: [user.id],
	}),
}));
