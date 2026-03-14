import { relations, sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { repos } from "./repos";

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
		state: text().default("working").notNull(),
		sessionType: text("session_type").default("coding").notNull(),
		sandboxId: text("sandbox_id"),
		previewUrl: text("preview_url"),
		agentBaseUrl: text("agent_base_url"),
		devtoolsBaseUrl: text("devtools_base_url"),
		agentSessionId: text("agent_session_id"),
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
		check(
			"sessions_state_check",
			sql`state = ANY (ARRAY['working'::text, 'idle'::text, 'cancelled'::text, 'done'::text])`,
		),
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
