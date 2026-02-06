/**
 * Schedules schema
 */

import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { automations } from "./automations";

// ============================================
// Schedules
// ============================================

export const schedules = pgTable(
	"schedules",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		automationId: uuid("automation_id")
			.notNull()
			.references(() => automations.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Schedule configuration
		name: text("name"),
		cronExpression: text("cron_expression").notNull(),
		timezone: text("timezone").default("UTC"),

		// Status
		enabled: boolean("enabled").default(true),
		lastRunAt: timestamp("last_run_at", { withTimezone: true }),
		nextRunAt: timestamp("next_run_at", { withTimezone: true }),

		// Metadata
		createdBy: text("created_by").references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_schedules_automation").on(table.automationId),
		index("idx_schedules_next_run").on(table.nextRunAt),
		index("idx_schedules_org").on(table.organizationId),
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
	createdByUser: one(user, {
		fields: [schedules.createdBy],
		references: [user.id],
	}),
}));
