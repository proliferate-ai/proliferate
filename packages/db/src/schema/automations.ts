/**
 * Automations schema
 */

import { relations } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { prebuilds } from "./prebuilds";

// ============================================
// Automations
// ============================================

export const automations = pgTable(
	"automations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Identity
		name: text("name").notNull().default("Untitled Automation"),
		description: text("description"),

		// Status
		enabled: boolean("enabled").default(true),

		// Agent configuration
		agentInstructions: text("agent_instructions"),
		agentType: text("agent_type").default("opencode"),
		modelId: text("model_id").default("claude-sonnet-4-20250514"),

		// Repository targeting (via prebuild)
		defaultPrebuildId: uuid("default_prebuild_id").references(() => prebuilds.id, {
			onDelete: "set null",
		}),
		allowAgenticRepoSelection: boolean("allow_agentic_repo_selection").default(false),

		// LLM configuration
		llmFilterPrompt: text("llm_filter_prompt"),
		enabledTools: jsonb("enabled_tools").default({}),
		llmAnalysisPrompt: text("llm_analysis_prompt"),

		// Notifications
		notificationChannelId: text("notification_channel_id"),

		// Metadata
		createdBy: text("created_by").references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("idx_automations_org").on(table.organizationId),
		index("idx_automations_enabled").on(table.enabled),
		index("idx_automations_prebuild").on(table.defaultPrebuildId),
	],
);

export const automationsRelations = relations(automations, ({ one, many }) => ({
	organization: one(organization, {
		fields: [automations.organizationId],
		references: [organization.id],
	}),
	createdByUser: one(user, {
		fields: [automations.createdBy],
		references: [user.id],
	}),
	defaultPrebuild: one(prebuilds, {
		fields: [automations.defaultPrebuildId],
		references: [prebuilds.id],
	}),
	triggers: many(triggers),
	schedules: many(schedules),
	sessions: many(sessions),
}));

import { schedules } from "./schedules";
import { sessions } from "./sessions";
// Forward declarations
import { triggers } from "./triggers";
