import { z } from "zod";

// ============================================
// Schemas
// ============================================

/**
 * Basic integration record schema.
 * Note: Fields use nullable() to match database column types.
 */
export const IntegrationSchema = z.object({
	id: z.string().uuid(),
	organization_id: z.string(),
	provider: z.string(),
	integration_id: z.string().nullable(),
	connection_id: z.string().nullable(),
	display_name: z.string().nullable(),
	status: z.string().nullable(),
	visibility: z.string().nullable(),
	created_by: z.string().nullable(),
	created_at: z.string().nullable(),
	updated_at: z.string().nullable(),
});

export type Integration = z.infer<typeof IntegrationSchema>;

/**
 * Integration with creator info attached.
 */
export const IntegrationWithCreatorSchema = IntegrationSchema.extend({
	creator: z
		.object({
			id: z.string(),
			name: z.string().nullable(),
			email: z.string().nullable(),
		})
		.nullable(),
});

export type IntegrationWithCreator = z.infer<typeof IntegrationWithCreatorSchema>;

/**
 * Provider connection status (simple boolean).
 */
export const ProviderStatusSchema = z.object({
	connected: z.boolean(),
});

/**
 * GitHub status includes creator info when connected.
 */
export const GitHubStatusSchema = z.object({
	connected: z.boolean(),
	createdBy: z.string().optional(),
	createdAt: z.string().optional(),
	creator: z
		.object({
			id: z.string(),
			name: z.string().nullable(),
			email: z.string().nullable(),
		})
		.nullable()
		.optional(),
});

/**
 * Slack status includes team info and support channel.
 */
export const SlackStatusSchema = z.object({
	connected: z.boolean(),
	teamId: z.string().optional(),
	teamName: z.string().optional(),
	scopes: z.array(z.string()).nullable().optional(),
	connectedAt: z.string().nullable().optional(),
	updatedAt: z.string().nullable().optional(),
	supportChannel: z
		.object({
			channelId: z.string(),
			channelName: z.string().nullable(),
			inviteUrl: z.string().nullable(),
		})
		.optional(),
});

/**
 * Sentry metadata types.
 */
export const SentryProjectSchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	platform: z.string().nullable(),
});

export const SentryEnvironmentSchema = z.object({
	name: z.string(),
});

export const SentryMetadataSchema = z.object({
	projects: z.array(SentryProjectSchema),
	environments: z.array(SentryEnvironmentSchema),
	levels: z.array(z.string()),
});

export type SentryMetadata = z.infer<typeof SentryMetadataSchema>;

/**
 * Linear metadata types.
 */
export const LinearTeamSchema = z.object({
	id: z.string(),
	name: z.string(),
	key: z.string(),
});

export const LinearStateSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(),
	color: z.string(),
});

export const LinearLabelSchema = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string(),
});

export const LinearUserSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
});

export const LinearProjectSchema = z.object({
	id: z.string(),
	name: z.string(),
});

export const LinearMetadataSchema = z.object({
	teams: z.array(LinearTeamSchema),
	states: z.array(LinearStateSchema),
	labels: z.array(LinearLabelSchema),
	users: z.array(LinearUserSchema),
	projects: z.array(LinearProjectSchema),
});

export type LinearMetadata = z.infer<typeof LinearMetadataSchema>;

/**
 * Jira metadata types.
 */
export const JiraSiteSchema = z.object({
	id: z.string(),
	name: z.string(),
	url: z.string(),
	avatarUrl: z.string().nullable(),
});

export const JiraProjectSchema = z.object({
	id: z.string(),
	key: z.string(),
	name: z.string(),
	projectTypeKey: z.string(),
});

export const JiraIssueTypeSchema = z.object({
	id: z.string(),
	name: z.string(),
	subtask: z.boolean(),
	description: z.string().nullable(),
});

export const JiraMetadataSchema = z.object({
	sites: z.array(JiraSiteSchema),
	selectedSiteId: z.string().nullable(),
	projects: z.array(JiraProjectSchema),
	issueTypes: z.array(JiraIssueTypeSchema),
});

export type JiraMetadata = z.infer<typeof JiraMetadataSchema>;
