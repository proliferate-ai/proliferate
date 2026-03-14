import { relations, sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

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

export const organization = pgTable(
	"organization",
	{
		id: text().primaryKey().notNull(),
		name: text().notNull(),
		slug: text().notNull(),
		logo: text(),
		createdAt: timestamp({ withTimezone: true, mode: "date" })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		isPersonal: boolean("is_personal").default(false).notNull(),
		autumnCustomerId: text("autumn_customer_id"),
	},
	(table) => [unique("organization_slug_key").on(table.slug)],
);

export const member = pgTable(
	"member",
	{
		id: text().primaryKey().notNull(),
		organizationId: text("organizationId")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text().notNull(),
		createdAt: timestamp({ withTimezone: true, mode: "date" })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
	},
	(table) => [
		index("member_organizationId_idx").on(table.organizationId),
		index("member_userId_idx").on(table.userId),
		unique("member_organizationId_userId_key").on(table.organizationId, table.userId),
	],
);

export const invitation = pgTable(
	"invitation",
	{
		id: text().primaryKey().notNull(),
		organizationId: text("organizationId")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		email: text().notNull(),
		role: text(),
		status: text().default("pending").notNull(),
		expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
		createdAt: timestamp({ withTimezone: true, mode: "date" })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		inviterId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("invitation_email_idx").on(table.email),
		index("invitation_organizationId_idx").on(table.organizationId),
	],
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
		updatedAt: timestamp({ withTimezone: true, mode: "date" })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		ipAddress: text(),
		userAgent: text(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		activeOrganizationId: text("activeOrganizationId").references(() => organization.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		index("session_userId_idx").on(table.userId),
		unique("session_token_key").on(table.token),
	],
);

export const account = pgTable(
	"account",
	{
		id: text().primaryKey().notNull(),
		accountId: text().notNull(),
		providerId: text().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
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
		updatedAt: timestamp({ withTimezone: true, mode: "date" })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
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
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
	accounts: many(account),
	sessions: many(session),
	memberships: many(member),
	invitationsSent: many(invitation),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
	memberships: many(member),
	invitations: many(invitation),
	authSessions: many(session),
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

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id],
	}),
	activeOrganization: one(organization, {
		fields: [session.activeOrganizationId],
		references: [organization.id],
	}),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id],
	}),
}));
