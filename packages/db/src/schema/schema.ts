import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	numeric,
	pgPolicy,
	pgTable,
	primaryKey,
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
		// Billing V2 fields
		billingState: text("billing_state").default("unconfigured").notNull(),
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
		// Overage + reconciliation fields (Phase 1.2)
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

export const repos = pgTable(
	"repos",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		githubUrl: text("github_url").notNull(),
		githubRepoId: text("github_repo_id").notNull(),
		githubRepoName: text("github_repo_name").notNull(),
		defaultBranch: text("default_branch").default("main"),
		setupCommands: text("setup_commands").array(),
		detectedStack: jsonb("detected_stack"),
		isOrphaned: boolean("is_orphaned").default(false),
		addedBy: text("added_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
		source: text().default("github"),
		isPrivate: boolean("is_private").default(false),
		localPathHash: text("local_path_hash"),
		repoSnapshotId: text("repo_snapshot_id"),
		repoSnapshotStatus: text("repo_snapshot_status"),
		repoSnapshotError: text("repo_snapshot_error"),
		repoSnapshotCommitSha: text("repo_snapshot_commit_sha"),
		repoSnapshotBuiltAt: timestamp("repo_snapshot_built_at", { withTimezone: true, mode: "date" }),
		repoSnapshotProvider: text("repo_snapshot_provider"),
		serviceCommands: jsonb("service_commands"),
		serviceCommandsUpdatedAt: timestamp("service_commands_updated_at", {
			withTimezone: true,
			mode: "date",
		}),
		serviceCommandsUpdatedBy: text("service_commands_updated_by"),
	},
	(table) => [
		index("idx_repos_local_path_hash")
			.using("btree", table.localPathHash.asc().nullsLast().op("text_ops"))
			.where(sql`(local_path_hash IS NOT NULL)`),
		index("idx_repos_org").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
		index("idx_repos_repo_snapshot_status").using(
			"btree",
			table.repoSnapshotStatus.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "repos_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.addedBy],
			foreignColumns: [user.id],
			name: "repos_added_by_fkey",
		}),
		unique("repos_organization_id_github_repo_id_key").on(table.organizationId, table.githubRepoId),
		check(
			"repos_source_check",
			sql`((source = 'local'::text) AND (local_path_hash IS NOT NULL)) OR (source <> 'local'::text)`,
		),
	],
);

export const configurations = pgTable(
	"configurations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		snapshotId: text("snapshot_id"),
		status: text().default("building"),
		error: text(),
		createdBy: text("created_by"),
		name: text().notNull(),
		notes: text(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		sandboxProvider: text("sandbox_provider").default("modal").notNull(),
		userId: text("user_id"),
		localPathHash: text("local_path_hash"),
		type: text().default("manual"),
		serviceCommands: jsonb("service_commands"),
		serviceCommandsUpdatedAt: timestamp("service_commands_updated_at", {
			withTimezone: true,
			mode: "date",
		}),
		serviceCommandsUpdatedBy: text("service_commands_updated_by"),
		envFiles: jsonb("env_files"),
		envFilesUpdatedAt: timestamp("env_files_updated_at", {
			withTimezone: true,
			mode: "date",
		}),
		envFilesUpdatedBy: text("env_files_updated_by"),
		connectors: jsonb("connectors"),
		connectorsUpdatedAt: timestamp("connectors_updated_at", {
			withTimezone: true,
			mode: "date",
		}),
		connectorsUpdatedBy: text("connectors_updated_by"),
	},
	(table) => [
		index("idx_configurations_sandbox_provider").using(
			"btree",
			table.sandboxProvider.asc().nullsLast().op("text_ops"),
		),
		index("idx_configurations_type_managed")
			.using("btree", table.type.asc().nullsLast().op("text_ops"))
			.where(sql`(type = 'managed'::text)`),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "configurations_created_by_fkey",
		}),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "configurations_user_id_fkey",
		}).onDelete("cascade"),
		unique("configurations_user_path_unique").on(table.userId, table.localPathHash),
		check(
			"configurations_sandbox_provider_check",
			sql`sandbox_provider = ANY (ARRAY['modal'::text, 'e2b'::text])`,
		),
		check(
			"configurations_cli_requires_path",
			sql`((user_id IS NOT NULL) AND (local_path_hash IS NOT NULL)) OR ((user_id IS NULL) AND (local_path_hash IS NULL))`,
		),
	],
);

export const repoConnections = pgTable(
	"repo_connections",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		repoId: uuid("repo_id").notNull(),
		integrationId: uuid("integration_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_repo_connections_integration").using(
			"btree",
			table.integrationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_repo_connections_repo").using(
			"btree",
			table.repoId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.repoId],
			foreignColumns: [repos.id],
			name: "repo_connections_repo_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.integrationId],
			foreignColumns: [integrations.id],
			name: "repo_connections_integration_id_fkey",
		}).onDelete("cascade"),
		unique("repo_connections_repo_id_integration_id_key").on(table.repoId, table.integrationId),
	],
);

export const integrations = pgTable(
	"integrations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		provider: text().notNull(),
		integrationId: text("integration_id").notNull(),
		connectionId: text("connection_id").notNull(),
		displayName: text("display_name"),
		scopes: text().array(),
		status: text().default("active"),
		visibility: text().default("org"),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
		githubInstallationId: text("github_installation_id"),
	},
	(table) => [
		index("idx_integrations_github_installation")
			.using("btree", table.githubInstallationId.asc().nullsLast().op("text_ops"))
			.where(sql`(github_installation_id IS NOT NULL)`),
		index("idx_integrations_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "integrations_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "integrations_created_by_fkey",
		}),
		unique("integrations_connection_id_key").on(table.connectionId),
		check(
			"integrations_visibility_check",
			sql`visibility = ANY (ARRAY['org'::text, 'private'::text])`,
		),
	],
);

export const secrets = pgTable(
	"secrets",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		repoId: uuid("repo_id"),
		key: text().notNull(),
		encryptedValue: text("encrypted_value").notNull(),
		secretType: text("secret_type").default("env"),
		description: text(),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
		configurationId: uuid("configuration_id"),
	},
	(table) => [
		index("idx_secrets_org").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
		index("idx_secrets_repo").using("btree", table.repoId.asc().nullsLast().op("uuid_ops")),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "secrets_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.repoId],
			foreignColumns: [repos.id],
			name: "secrets_repo_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "secrets_created_by_fkey",
		}),
		foreignKey({
			columns: [table.configurationId],
			foreignColumns: [configurations.id],
			name: "secrets_configuration_id_fkey",
		}).onDelete("cascade"),
		unique("secrets_org_repo_configuration_key_unique").on(
			table.organizationId,
			table.repoId,
			table.key,
			table.configurationId,
		),
	],
);

export const triggers = pgTable(
	"triggers",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		automationId: uuid("automation_id").notNull(),
		name: text(),
		description: text(),
		triggerType: text("trigger_type").default("webhook").notNull(),
		provider: text().notNull(),
		enabled: boolean().default(true),
		executionMode: text("execution_mode").default("auto"),
		allowAgenticRepoSelection: boolean("allow_agentic_repo_selection").default(false),
		agentInstructions: text("agent_instructions"),
		webhookSecret: text("webhook_secret"),
		webhookUrlPath: text("webhook_url_path"),
		pollingCron: text("polling_cron"),
		pollingEndpoint: text("polling_endpoint"),
		pollingState: jsonb("polling_state").default({}),
		lastPolledAt: timestamp("last_polled_at", { withTimezone: true, mode: "date" }),
		config: jsonb().default({}),
		integrationId: uuid("integration_id"),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
		repeatJobKey: text("repeat_job_key"),
	},
	(table) => [
		index("idx_triggers_automation").using(
			"btree",
			table.automationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_triggers_enabled_polling")
			.using(
				"btree",
				table.enabled.asc().nullsLast().op("bool_ops"),
				table.triggerType.asc().nullsLast().op("text_ops"),
			)
			.where(sql`((trigger_type = 'polling'::text) AND (enabled = true))`),
		index("idx_triggers_enabled_scheduled")
			.using(
				"btree",
				table.enabled.asc().nullsLast().op("bool_ops"),
				table.provider.asc().nullsLast().op("text_ops"),
			)
			.where(sql`((provider = 'scheduled'::text) AND (enabled = true))`),
		index("idx_triggers_org").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
		index("idx_triggers_repeat_job_key")
			.using("btree", table.repeatJobKey.asc().nullsLast().op("text_ops"))
			.where(sql`(repeat_job_key IS NOT NULL)`),
		index("idx_triggers_webhook_path").using(
			"btree",
			table.webhookUrlPath.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "triggers_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.automationId],
			foreignColumns: [automations.id],
			name: "triggers_automation_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.integrationId],
			foreignColumns: [integrations.id],
			name: "triggers_integration_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "triggers_created_by_fkey",
		}),
		unique("triggers_webhook_url_path_key").on(table.webhookUrlPath),
	],
);

export const automations = pgTable(
	"automations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		name: text().default("Untitled Automation").notNull(),
		description: text(),
		enabled: boolean().default(true),
		agentInstructions: text("agent_instructions"),
		agentType: text("agent_type").default("opencode"),
		modelId: text("model_id").default("claude-sonnet-4-20250514"),
		allowAgenticRepoSelection: boolean("allow_agentic_repo_selection").default(false),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
		defaultConfigurationId: uuid("default_configuration_id"),
		llmFilterPrompt: text("llm_filter_prompt"),
		enabledTools: jsonb("enabled_tools").default({}),
		llmAnalysisPrompt: text("llm_analysis_prompt"),
		notificationChannelId: text("notification_channel_id"),
		notificationSlackInstallationId: uuid("notification_slack_installation_id"),
		actionModes: jsonb("action_modes"),
		sourceTemplateId: text("source_template_id"),
	},
	(table) => [
		index("idx_automations_enabled")
			.using("btree", table.enabled.asc().nullsLast().op("bool_ops"))
			.where(sql`(enabled = true)`),
		index("idx_automations_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		index("idx_automations_configuration").using(
			"btree",
			table.defaultConfigurationId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "automations_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "automations_created_by_fkey",
		}),
		foreignKey({
			columns: [table.defaultConfigurationId],
			foreignColumns: [configurations.id],
			name: "automations_default_configuration_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.notificationSlackInstallationId],
			foreignColumns: [slackInstallations.id],
			name: "automations_notification_slack_installation_id_fkey",
		}).onDelete("set null"),
		pgPolicy("Users can delete automations in their org", {
			as: "permissive",
			for: "delete",
			to: ["public"],
			using: sql`(organization_id IN ( SELECT member."organizationId"
   FROM member
  WHERE (member."userId" = auth.uid())))`,
		}),
		pgPolicy("Users can update automations in their org", {
			as: "permissive",
			for: "update",
			to: ["public"],
		}),
		pgPolicy("Users can insert automations in their org", {
			as: "permissive",
			for: "insert",
			to: ["public"],
		}),
		pgPolicy("Users can view automations in their org", {
			as: "permissive",
			for: "select",
			to: ["public"],
		}),
	],
);

export const automationConnections = pgTable(
	"automation_connections",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		automationId: uuid("automation_id").notNull(),
		integrationId: uuid("integration_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_automation_connections_automation").using(
			"btree",
			table.automationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_automation_connections_integration").using(
			"btree",
			table.integrationId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.automationId],
			foreignColumns: [automations.id],
			name: "automation_connections_automation_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.integrationId],
			foreignColumns: [integrations.id],
			name: "automation_connections_integration_id_fkey",
		}).onDelete("cascade"),
		unique("automation_connections_automation_id_integration_id_key").on(
			table.automationId,
			table.integrationId,
		),
	],
);

export const sessionConnections = pgTable(
	"session_connections",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		integrationId: uuid("integration_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_session_connections_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_session_connections_integration").using(
			"btree",
			table.integrationId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "session_connections_session_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.integrationId],
			foreignColumns: [integrations.id],
			name: "session_connections_integration_id_fkey",
		}).onDelete("cascade"),
		unique("session_connections_session_id_integration_id_key").on(
			table.sessionId,
			table.integrationId,
		),
	],
);

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

export const triggerEvents = pgTable(
	"trigger_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		triggerId: uuid("trigger_id").notNull(),
		organizationId: text("organization_id").notNull(),
		externalEventId: text("external_event_id"),
		providerEventType: text("provider_event_type"),
		status: text().default("queued"),
		sessionId: uuid("session_id").references((): AnyPgColumn => sessions.id, {
			onDelete: "set null",
		}),
		rawPayload: jsonb("raw_payload").notNull(),
		parsedContext: jsonb("parsed_context"),
		errorMessage: text("error_message"),
		processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
		skipReason: text("skip_reason"),
		dedupKey: text("dedup_key"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		enrichedData: jsonb("enriched_data"),
		llmFilterResult: jsonb("llm_filter_result"),
		llmAnalysisResult: jsonb("llm_analysis_result"),
	},
	(table) => [
		uniqueIndex("idx_trigger_events_dedup")
			.using(
				"btree",
				table.triggerId.asc().nullsLast().op("uuid_ops"),
				table.dedupKey.asc().nullsLast().op("text_ops"),
			)
			.where(sql`(dedup_key IS NOT NULL)`),
		index("idx_trigger_events_org_status").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.status.asc().nullsLast().op("text_ops"),
		),
		index("idx_trigger_events_queued")
			.using(
				"btree",
				table.status.asc().nullsLast().op("text_ops"),
				table.createdAt.asc().nullsLast().op("timestamptz_ops"),
			)
			.where(sql`(status = 'queued'::text)`),
		index("idx_trigger_events_skipped")
			.using(
				"btree",
				table.triggerId.asc().nullsLast().op("uuid_ops"),
				table.status.asc().nullsLast().op("text_ops"),
			)
			.where(sql`(status = 'skipped'::text)`),
		index("idx_trigger_events_status").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
		),
		index("idx_trigger_events_trigger").using(
			"btree",
			table.triggerId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.triggerId],
			foreignColumns: [triggers.id],
			name: "trigger_events_trigger_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "trigger_events_organization_id_fkey",
		}).onDelete("cascade"),
	],
);

export const triggerEventActions = pgTable(
	"trigger_event_actions",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		triggerEventId: uuid("trigger_event_id").notNull(),
		toolName: text("tool_name").notNull(),
		status: text().default("pending"),
		inputData: jsonb("input_data"),
		outputData: jsonb("output_data"),
		errorMessage: text("error_message"),
		startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
		completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
		durationMs: integer("duration_ms"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_trigger_event_actions_event").using(
			"btree",
			table.triggerEventId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_trigger_event_actions_status").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.triggerEventId],
			foreignColumns: [triggerEvents.id],
			name: "trigger_event_actions_trigger_event_id_fkey",
		}).onDelete("cascade"),
	],
);

export const automationRuns = pgTable(
	"automation_runs",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		automationId: uuid("automation_id").notNull(),
		triggerEventId: uuid("trigger_event_id").notNull(),
		triggerId: uuid("trigger_id"),
		status: text().default("queued").notNull(),
		statusReason: text("status_reason"),
		failureStage: text("failure_stage"),
		leaseOwner: text("lease_owner"),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
		leaseVersion: integer("lease_version").default(0).notNull(),
		attempt: integer("attempt").default(0).notNull(),
		queuedAt: timestamp("queued_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
		enrichmentStartedAt: timestamp("enrichment_started_at", {
			withTimezone: true,
			mode: "date",
		}),
		enrichmentCompletedAt: timestamp("enrichment_completed_at", {
			withTimezone: true,
			mode: "date",
		}),
		executionStartedAt: timestamp("execution_started_at", {
			withTimezone: true,
			mode: "date",
		}),
		promptSentAt: timestamp("prompt_sent_at", { withTimezone: true, mode: "date" }),
		completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
		lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: "date" }),
		deadlineAt: timestamp("deadline_at", { withTimezone: true, mode: "date" }),
		sessionId: uuid("session_id"),
		sessionCreatedAt: timestamp("session_created_at", { withTimezone: true, mode: "date" }),
		completionId: text("completion_id"),
		completionJson: jsonb("completion_json"),
		completionArtifactRef: text("completion_artifact_ref"),
		enrichmentJson: jsonb("enrichment_json"),
		enrichmentArtifactRef: text("enrichment_artifact_ref"),
		sourcesArtifactRef: text("sources_artifact_ref"),
		policyArtifactRef: text("policy_artifact_ref"),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		assignedTo: text("assigned_to"),
		assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_automation_runs_status_lease").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
			table.leaseExpiresAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("idx_automation_runs_org_status").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.status.asc().nullsLast().op("text_ops"),
		),
		index("idx_automation_runs_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		uniqueIndex("idx_automation_runs_trigger_event").using(
			"btree",
			table.triggerEventId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "automation_runs_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.automationId],
			foreignColumns: [automations.id],
			name: "automation_runs_automation_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.triggerEventId],
			foreignColumns: [triggerEvents.id],
			name: "automation_runs_trigger_event_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.triggerId],
			foreignColumns: [triggers.id],
			name: "automation_runs_trigger_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "automation_runs_session_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [user.id],
			name: "automation_runs_assigned_to_fkey",
		}).onDelete("set null"),
		index("idx_automation_runs_assigned_to").using(
			"btree",
			table.assignedTo.asc().nullsLast().op("text_ops"),
		),
	],
);

export const automationRunEvents = pgTable(
	"automation_run_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		runId: uuid("run_id").notNull(),
		type: text("type").notNull(),
		fromStatus: text("from_status"),
		toStatus: text("to_status"),
		data: jsonb("data"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_automation_run_events_run").using(
			"btree",
			table.runId.asc().nullsLast().op("uuid_ops"),
			table.createdAt.desc().nullsLast().op("timestamptz_ops"),
		),
		foreignKey({
			columns: [table.runId],
			foreignColumns: [automationRuns.id],
			name: "automation_run_events_run_id_fkey",
		}).onDelete("cascade"),
	],
);

export const automationSideEffects = pgTable(
	"automation_side_effects",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		runId: uuid("run_id").notNull(),
		organizationId: text("organization_id").notNull(),
		effectId: text("effect_id").notNull(),
		kind: text().notNull(),
		provider: text(),
		requestHash: text("request_hash"),
		responseJson: jsonb("response_json"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		unique("automation_side_effects_org_effect_key").on(table.organizationId, table.effectId),
		index("idx_automation_side_effects_run").using(
			"btree",
			table.runId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.runId],
			foreignColumns: [automationRuns.id],
			name: "automation_side_effects_run_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "automation_side_effects_organization_id_fkey",
		}).onDelete("cascade"),
	],
);

export const outbox = pgTable(
	"outbox",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		kind: text().notNull(),
		payload: jsonb("payload").notNull(),
		status: text().default("pending").notNull(),
		attempts: integer("attempts").default(0).notNull(),
		availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }).defaultNow(),
		claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
		lastError: text("last_error"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_outbox_status_available").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
			table.availableAt.asc().nullsLast().op("timestamptz_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "outbox_organization_id_fkey",
		}).onDelete("cascade"),
	],
);

export const slackConversations = pgTable(
	"slack_conversations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		slackInstallationId: uuid("slack_installation_id").notNull(),
		channelId: text("channel_id").notNull(),
		threadTs: text("thread_ts").notNull(),
		sessionId: uuid("session_id"),
		repoId: uuid("repo_id"),
		startedBySlackUserId: text("started_by_slack_user_id"),
		status: text().default("active"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "date" }).defaultNow(),
		pendingPrompt: text("pending_prompt"),
	},
	(table) => [
		index("idx_slack_conversations_installation").using(
			"btree",
			table.slackInstallationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_slack_conversations_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_slack_conversations_thread").using(
			"btree",
			table.channelId.asc().nullsLast().op("text_ops"),
			table.threadTs.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.slackInstallationId],
			foreignColumns: [slackInstallations.id],
			name: "slack_conversations_slack_installation_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "slack_conversations_session_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.repoId],
			foreignColumns: [repos.id],
			name: "slack_conversations_repo_id_fkey",
		}),
		unique("slack_conversations_slack_installation_id_channel_id_thread_key").on(
			table.slackInstallationId,
			table.channelId,
			table.threadTs,
		),
	],
);

export const actionInvocations = pgTable(
	"action_invocations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		organizationId: text("organization_id").notNull(),
		integrationId: uuid("integration_id"),
		integration: text("integration").notNull(),
		action: text("action").notNull(),
		riskLevel: text("risk_level").notNull(),
		mode: text("mode"),
		modeSource: text("mode_source"),
		params: jsonb("params"),
		status: text("status").default("pending").notNull(),
		result: jsonb("result"),
		error: text("error"),
		deniedReason: text("denied_reason"),
		durationMs: integer("duration_ms"),
		approvedBy: text("approved_by"),
		approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
		completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_action_invocations_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_action_invocations_org_created").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.createdAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("idx_action_invocations_status_expires").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
			table.expiresAt.asc().nullsLast().op("timestamptz_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "action_invocations_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.integrationId],
			foreignColumns: [integrations.id],
			name: "action_invocations_integration_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "action_invocations_session_id_fkey",
		}).onDelete("cascade"),
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

export const cliDeviceCodes = pgTable(
	"cli_device_codes",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userCode: text("user_code").notNull(),
		deviceCode: text("device_code").notNull(),
		userId: text("user_id"),
		orgId: text("org_id"),
		status: text().default("pending").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		authorizedAt: timestamp("authorized_at", { withTimezone: true, mode: "date" }),
	},
	(table) => [
		index("idx_cli_device_codes_device_code").using(
			"btree",
			table.deviceCode.asc().nullsLast().op("text_ops"),
		),
		index("idx_cli_device_codes_expires").using(
			"btree",
			table.expiresAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("idx_cli_device_codes_user_code").using(
			"btree",
			table.userCode.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "cli_device_codes_user_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.orgId],
			foreignColumns: [organization.id],
			name: "cli_device_codes_org_id_fkey",
		}).onDelete("cascade"),
		unique("cli_device_codes_user_code_key").on(table.userCode),
		unique("cli_device_codes_device_code_key").on(table.deviceCode),
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

export const slackInstallations = pgTable(
	"slack_installations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		teamId: text("team_id").notNull(),
		teamName: text("team_name"),
		encryptedBotToken: text("encrypted_bot_token").notNull(),
		botUserId: text("bot_user_id").notNull(),
		scopes: text().array(),
		installedBy: text("installed_by"),
		status: text().default("active"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
		supportChannelId: text("support_channel_id"),
		supportChannelName: text("support_channel_name"),
		supportInviteId: text("support_invite_id"),
		supportInviteUrl: text("support_invite_url"),
	},
	(table) => [
		index("idx_slack_installations_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		index("idx_slack_installations_team").using(
			"btree",
			table.teamId.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "slack_installations_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.installedBy],
			foreignColumns: [user.id],
			name: "slack_installations_installed_by_fkey",
		}),
		unique("slack_installations_organization_id_team_id_key").on(
			table.organizationId,
			table.teamId,
		),
	],
);

export const sessions = pgTable(
	"sessions",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		repoId: uuid("repo_id"),
		organizationId: text("organization_id").notNull(),
		createdBy: text("created_by"),
		sessionType: text("session_type").default("coding"),
		status: text().default("starting"),
		sandboxId: text("sandbox_id"),
		snapshotId: text("snapshot_id"),
		branchName: text("branch_name"),
		baseCommitSha: text("base_commit_sha"),
		parentSessionId: uuid("parent_session_id"),
		initialPrompt: text("initial_prompt"),
		title: text(),
		automationId: uuid("automation_id"),
		triggerId: uuid("trigger_id"),
		triggerEventId: uuid("trigger_event_id").references((): AnyPgColumn => triggerEvents.id, {
			onDelete: "set null",
		}),
		startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).defaultNow(),
		lastActivityAt: timestamp("last_activity_at", {
			withTimezone: true,
			mode: "date",
		}).defaultNow(),
		pausedAt: timestamp("paused_at", { withTimezone: true, mode: "date" }),
		endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
		idleTimeoutMinutes: integer("idle_timeout_minutes").default(30),
		autoDeleteDays: integer("auto_delete_days").default(7),
		source: text().default("web"),
		sandboxProvider: text("sandbox_provider").default("modal").notNull(),
		origin: text().default("web"),
		localPathHash: text("local_path_hash"),
		sandboxUrl: text("sandbox_url"),
		codingAgentSessionId: text("coding_agent_session_id"),
		openCodeTunnelUrl: text("open_code_tunnel_url"),
		previewTunnelUrl: text("preview_tunnel_url"),
		agentConfig: jsonb("agent_config"),
		systemPrompt: text("system_prompt"),
		clientType: text("client_type"),
		clientMetadata: jsonb("client_metadata"),
		configurationId: uuid("configuration_id"),
		idempotencyKey: text("idempotency_key"),
		sandboxExpiresAt: timestamp("sandbox_expires_at", { withTimezone: true, mode: "date" }),
		meteredThroughAt: timestamp("metered_through_at", { withTimezone: true, mode: "date" }),
		lastSeenAliveAt: timestamp("last_seen_alive_at", { withTimezone: true, mode: "date" }),
		aliveCheckFailures: integer("alive_check_failures").default(0),
		pauseReason: text("pause_reason"),
		stopReason: text("stop_reason"),
		// Phase 2: Session telemetry
		outcome: text("outcome"),
		summary: text("summary"),
		prUrls: jsonb("pr_urls"),
		metrics: jsonb("metrics"),
		latestTask: text("latest_task"),
	},
	(table) => [
		index("idx_sessions_automation").using(
			"btree",
			table.automationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_sessions_client_type").using(
			"btree",
			table.clientType.asc().nullsLast().op("text_ops"),
		),
		index("idx_sessions_local_path_hash")
			.using("btree", table.localPathHash.asc().nullsLast().op("text_ops"))
			.where(sql`(local_path_hash IS NOT NULL)`),
		index("idx_sessions_org").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
		index("idx_sessions_parent").using(
			"btree",
			table.parentSessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_sessions_configuration").using(
			"btree",
			table.configurationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_sessions_repo").using("btree", table.repoId.asc().nullsLast().op("uuid_ops")),
		index("idx_sessions_sandbox_expires_at")
			.using("btree", table.sandboxExpiresAt.asc().nullsLast().op("timestamptz_ops"))
			.where(sql`(sandbox_expires_at IS NOT NULL)`),
		index("idx_sessions_sandbox_provider").using(
			"btree",
			table.sandboxProvider.asc().nullsLast().op("text_ops"),
		),
		index("idx_sessions_slack_lookup")
			.using(
				"btree",
				sql`((client_metadata ->> 'installationId'::text))`,
				sql`((client_metadata ->> 'channelId'::text))`,
				sql`((client_metadata ->> 'threadTs'::text))`,
			)
			.where(sql`(client_type = 'slack'::text)`),
		index("idx_sessions_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
		index("idx_sessions_trigger").using("btree", table.triggerId.asc().nullsLast().op("uuid_ops")),
		unique("idx_sessions_automation_trigger_event").on(table.automationId, table.triggerEventId),
		foreignKey({
			columns: [table.repoId],
			foreignColumns: [repos.id],
			name: "sessions_repo_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "sessions_organization_id_fkey",
		}),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "sessions_created_by_fkey",
		}),
		foreignKey({
			columns: [table.parentSessionId],
			foreignColumns: [table.id],
			name: "sessions_parent_session_id_fkey",
		}),
		foreignKey({
			columns: [table.automationId],
			foreignColumns: [automations.id],
			name: "sessions_automation_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.triggerId],
			foreignColumns: [triggers.id],
			name: "sessions_trigger_id_fkey",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.configurationId],
			foreignColumns: [configurations.id],
			name: "sessions_configuration_id_fkey",
		}).onDelete("cascade"),
		check(
			"sessions_sandbox_provider_check",
			sql`sandbox_provider = ANY (ARRAY['modal'::text, 'e2b'::text])`,
		),
	],
);

/**
 * Global idempotency lookup table for billing events.
 * Maintains global uniqueness of idempotency keys across partitions.
 * Must be inserted into atomically with billing_events within the same transaction.
 */
export const billingEventKeys = pgTable("billing_event_keys", {
	idempotencyKey: text("idempotency_key").primaryKey().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const billingEvents = pgTable(
	"billing_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		eventType: text("event_type").notNull(),
		quantity: numeric({ precision: 12, scale: 6 }).notNull(),
		credits: numeric({ precision: 12, scale: 6 }).notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		sessionIds: text("session_ids").array().default([""]),
		status: text().default("pending").notNull(),
		retryCount: integer("retry_count").default(0),
		nextRetryAt: timestamp("next_retry_at", { withTimezone: true, mode: "date" }).defaultNow(),
		lastError: text("last_error"),
		autumnResponse: jsonb("autumn_response"),
		metadata: jsonb().default({}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_billing_events_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.createdAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("idx_billing_events_outbox")
			.using(
				"btree",
				table.status.asc().nullsLast().op("text_ops"),
				table.nextRetryAt.asc().nullsLast().op("timestamptz_ops"),
			)
			.where(sql`(status = ANY (ARRAY['pending'::text, 'failed'::text]))`),
		index("idx_billing_events_session").using(
			"gin",
			table.sessionIds.asc().nullsLast().op("array_ops"),
		),
		index("idx_billing_events_type").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.eventType.asc().nullsLast().op("text_ops"),
			table.createdAt.asc().nullsLast().op("timestamptz_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "billing_events_organization_id_fkey",
		}).onDelete("cascade"),
		unique("billing_events_idempotency_key_key").on(table.idempotencyKey),
	],
);

export const configurationRepos = pgTable(
	"configuration_repos",
	{
		configurationId: uuid("configuration_id").notNull(),
		repoId: uuid("repo_id").notNull(),
		workspacePath: text("workspace_path").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_configuration_repos_configuration").using(
			"btree",
			table.configurationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_configuration_repos_repo").using(
			"btree",
			table.repoId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.configurationId],
			foreignColumns: [configurations.id],
			name: "configuration_repos_configuration_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.repoId],
			foreignColumns: [repos.id],
			name: "configuration_repos_repo_id_fkey",
		}).onDelete("cascade"),
		primaryKey({
			columns: [table.configurationId, table.repoId],
			name: "configuration_repos_pkey",
		}),
	],
);

export const cliGithubSelections = pgTable(
	"cli_github_selections",
	{
		userId: text("user_id").notNull(),
		organizationId: text("organization_id").notNull(),
		connectionId: text("connection_id").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_cli_github_selections_expires_at").using(
			"btree",
			table.expiresAt.asc().nullsLast().op("timestamptz_ops"),
		),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "cli_github_selections_user_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "cli_github_selections_organization_id_fkey",
		}).onDelete("cascade"),
		primaryKey({
			columns: [table.userId, table.organizationId],
			name: "cli_github_selections_pkey",
		}),
	],
);

// ============================================
// Billing V2 Tables
// ============================================

/**
 * LLM spend cursor — per-org partitioned.
 */
export const llmSpendCursors = pgTable("llm_spend_cursors", {
	organizationId: text("organization_id")
		.primaryKey()
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	lastStartTime: timestamp("last_start_time", { withTimezone: true, mode: "date" }).notNull(),
	lastRequestId: text("last_request_id"),
	recordsProcessed: integer("records_processed").default(0).notNull(),
	syncedAt: timestamp("synced_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

/**
 * Billing reconciliation audit trail.
 */
export const billingReconciliations = pgTable(
	"billing_reconciliations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		type: text().notNull(), // 'shadow_sync' | 'manual_adjustment' | 'refund' | 'correction'
		previousBalance: numeric("previous_balance", { precision: 12, scale: 6 }).notNull(),
		newBalance: numeric("new_balance", { precision: 12, scale: 6 }).notNull(),
		delta: numeric({ precision: 12, scale: 6 }).notNull(),
		reason: text().notNull(),
		performedBy: text("performed_by"), // null for automated reconciliation
		metadata: jsonb().default({}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_billing_reconciliations_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
			table.createdAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("idx_billing_reconciliations_type").using(
			"btree",
			table.type.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "billing_reconciliations_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.performedBy],
			foreignColumns: [user.id],
			name: "billing_reconciliations_performed_by_fkey",
		}).onDelete("set null"),
	],
);

// ============================================
// Sandbox Base Snapshots
// ============================================

export const sandboxBaseSnapshots = pgTable(
	"sandbox_base_snapshots",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		versionKey: text("version_key").notNull(),
		snapshotId: text("snapshot_id"),
		status: text().default("building").notNull(),
		error: text(),
		provider: text().default("modal").notNull(),
		modalAppName: text("modal_app_name").notNull(),
		builtAt: timestamp("built_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		uniqueIndex("idx_sandbox_base_snapshots_version_provider_app").using(
			"btree",
			table.versionKey.asc().nullsLast().op("text_ops"),
			table.provider.asc().nullsLast().op("text_ops"),
			table.modalAppName.asc().nullsLast().op("text_ops"),
		),
		index("idx_sandbox_base_snapshots_status").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
		),
		check(
			"sandbox_base_snapshots_status_check",
			sql`status = ANY (ARRAY['building'::text, 'ready'::text, 'failed'::text])`,
		),
	],
);

// ============================================
// Org Connectors (org-scoped MCP connector catalog)
// ============================================

export const orgConnectors = pgTable(
	"org_connectors",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		name: text().notNull(),
		transport: text().notNull().default("remote_http"),
		url: text().notNull(),
		auth: jsonb().notNull(),
		riskPolicy: jsonb("risk_policy"),
		toolRiskOverrides: jsonb("tool_risk_overrides"),
		enabled: boolean().notNull().default(true),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_org_connectors_org").on(table.organizationId),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "org_connectors_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "org_connectors_created_by_fkey",
		}),
	],
);

// ============================================
// vNext Tables
// ============================================

/**
 * Webhook inbox — raw webhook events received before processing.
 * Decouples ingestion from processing for reliability.
 */
export const webhookInbox = pgTable(
	"webhook_inbox",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id"),
		provider: text().notNull(),
		externalId: text("external_id"),
		headers: jsonb(),
		payload: jsonb().notNull(),
		signature: text(),
		status: text().default("pending").notNull(),
		error: text(),
		processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
		receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_webhook_inbox_status").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
			table.receivedAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("idx_webhook_inbox_provider").using(
			"btree",
			table.provider.asc().nullsLast().op("text_ops"),
		),
		index("idx_webhook_inbox_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
	],
);

/**
 * Trigger poll groups — groups polling triggers by provider+connection for efficient batch polling.
 */
export const triggerPollGroups = pgTable(
	"trigger_poll_groups",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		provider: text().notNull(),
		integrationId: uuid("integration_id"),
		cronExpression: text("cron_expression").notNull(),
		enabled: boolean().default(true),
		lastPolledAt: timestamp("last_polled_at", { withTimezone: true, mode: "date" }),
		cursor: jsonb(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_trigger_poll_groups_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		index("idx_trigger_poll_groups_enabled").using(
			"btree",
			table.enabled.asc().nullsLast().op("bool_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "trigger_poll_groups_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.integrationId],
			foreignColumns: [integrations.id],
			name: "trigger_poll_groups_integration_id_fkey",
		}).onDelete("set null"),
		unique("uq_poll_groups_org_provider_integration")
			.on(table.organizationId, table.provider, table.integrationId)
			.nullsNotDistinct(),
	],
);

/**
 * Session tool invocations — records tool calls within sessions for audit and observability.
 */
export const sessionToolInvocations = pgTable(
	"session_tool_invocations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		sessionId: uuid("session_id").notNull(),
		organizationId: text("organization_id").notNull(),
		toolName: text("tool_name").notNull(),
		toolSource: text("tool_source"),
		status: text().default("pending"),
		input: jsonb(),
		output: jsonb(),
		error: text(),
		durationMs: integer("duration_ms"),
		startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
		completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_session_tool_invocations_session").using(
			"btree",
			table.sessionId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_session_tool_invocations_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		index("idx_session_tool_invocations_status").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "session_tool_invocations_session_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "session_tool_invocations_organization_id_fkey",
		}).onDelete("cascade"),
	],
);

/**
 * User action preferences — per-user, per-org toggles for action sources.
 * Absence of a row means "enabled" (default). Rows are stored for explicit opt-outs.
 * sourceId is the action source key (e.g. "linear", "connector:<uuid>").
 * actionId is null for source-level toggles, or a specific action ID for per-action granularity.
 */
export const userActionPreferences = pgTable(
	"user_action_preferences",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		organizationId: text("organization_id").notNull(),
		sourceId: text("source_id").notNull(),
		actionId: text("action_id"),
		enabled: boolean().notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_user_action_prefs_user_org").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "user_action_preferences_user_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "user_action_preferences_organization_id_fkey",
		}).onDelete("cascade"),
		unique("user_action_prefs_user_org_source_action_key")
			.on(table.userId, table.organizationId, table.sourceId, table.actionId)
			.nullsNotDistinct(),
	],
);

/**
 * Secret files — file-based secrets written to sandbox (replaces secret_bundles approach).
 */
export const secretFiles = pgTable(
	"secret_files",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		organizationId: text("organization_id").notNull(),
		configurationId: uuid("configuration_id"),
		filePath: text("file_path").notNull(),
		encryptedContent: text("encrypted_content").notNull(),
		description: text(),
		createdBy: text("created_by"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_secret_files_org").using(
			"btree",
			table.organizationId.asc().nullsLast().op("text_ops"),
		),
		index("idx_secret_files_configuration").using(
			"btree",
			table.configurationId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "secret_files_organization_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.configurationId],
			foreignColumns: [configurations.id],
			name: "secret_files_configuration_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "secret_files_created_by_fkey",
		}),
		unique("secret_files_org_config_path_unique").on(
			table.organizationId,
			table.configurationId,
			table.filePath,
		),
	],
);

/**
 * Configuration secrets — links configurations to secrets for scoped secret injection.
 */
export const configurationSecrets = pgTable(
	"configuration_secrets",
	{
		configurationId: uuid("configuration_id").notNull(),
		secretId: uuid("secret_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
	},
	(table) => [
		index("idx_configuration_secrets_configuration").using(
			"btree",
			table.configurationId.asc().nullsLast().op("uuid_ops"),
		),
		index("idx_configuration_secrets_secret").using(
			"btree",
			table.secretId.asc().nullsLast().op("uuid_ops"),
		),
		foreignKey({
			columns: [table.configurationId],
			foreignColumns: [configurations.id],
			name: "configuration_secrets_configuration_id_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.secretId],
			foreignColumns: [secrets.id],
			name: "configuration_secrets_secret_id_fkey",
		}).onDelete("cascade"),
		primaryKey({
			columns: [table.configurationId, table.secretId],
			name: "configuration_secrets_pkey",
		}),
	],
);
