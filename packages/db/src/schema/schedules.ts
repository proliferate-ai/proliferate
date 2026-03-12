import { relations, sql } from "drizzle-orm";
import {
	boolean,
	foreignKey,
	index,
	pgPolicy,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { automations } from "./automations";

export const schedules = pgTable(
	"schedules",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		automationId: uuid("automation_id").notNull(),
		organizationId: text("organization_id").notNull(),
		name: text(),
		cronExpression: text("cron_expression").notNull(),
		timezone: text().default("UTC"),
		enabled: boolean().default(true),
		lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: "date" }),
		nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: "date" }),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_schedules_automation").using(
			"btree",
			table.automationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_schedules_next_run")
			.using("btree", table.nextRunAt.asc().nullsLast().op("timestamptz_ops"))
			.where(sql`(enabled = true)`),
		index("idx_schedules_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.automationId],
			foreignColumns: [automations.id],
			name: "schedules_automation_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "schedules_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "schedules_created_by_fkey",
		}),
		pgPolicy("Users can delete schedules in their org", {
			as: "permissive",
			for: "delete",
			to: ["public"],
			using: sql`(organization_id IN ( SELECT member."organizationId"
   FROM member
  WHERE (member."userId" = auth.uid())))`,
		}),
		pgPolicy("Users can update schedules in their org", {
			as: "permissive",
			for: "update",
			to: ["public"],
		}),
		pgPolicy("Users can insert schedules in their org", {
			as: "permissive",
			for: "insert",
			to: ["public"],
		}),
		pgPolicy("Users can view schedules in their org", {
			as: "permissive",
			for: "select",
			to: ["public"],
		}),
	],
);

export const schedulesRelations = relations(schedules, ({ one }) => ({
	automation: one(automations, {
		fields: [schedules.automationId],
		references: [automations.id],
	}),
	organization: one(organization, {
		fields: [schedules.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [schedules.createdBy],
		references: [user.id],
	}),
}));
