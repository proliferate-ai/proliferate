import { relations } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { repos } from "./repos";

export const sessionState = pgEnum("session_state", ["working", "idle", "cancelled", "done"]);

export const sessions = pgTable(
	"sessions",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		repoId: uuid("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		state: sessionState().default("working").notNull(),
		sessionType: text("session_type").default("coding").notNull(),
		sandboxId: text("sandbox_id"),
		previewUrl: text("preview_url"),
		agentBaseUrl: text("agent_base_url"),
		devtoolsBaseUrl: text("devtools_base_url"),
		sandboxAgentId: text("sandbox_agent_id"),
		prMetadata: jsonb("pr_metadata"),
		initialPrompt: text("initial_prompt"),
		harnessType: text("harness_type").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
	},
	(table) => [
		index("sessions_repo_id_idx").on(table.repoId),
		index("sessions_organization_id_idx").on(table.organizationId),
		index("sessions_created_by_idx").on(table.createdBy),
		index("sessions_state_idx").on(table.state),
	],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
	repo: one(repos, {
		fields: [sessions.repoId],
		references: [repos.id],
	}),
	organization: one(organization, {
		fields: [sessions.organizationId],
		references: [organization.id],
	}),
	creator: one(user, {
		fields: [sessions.createdBy],
		references: [user.id],
	}),
}));
