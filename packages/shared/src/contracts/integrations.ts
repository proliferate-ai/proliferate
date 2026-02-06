import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

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

// ============================================
// Contract
// ============================================

export const integrationsContract = c.router(
	{
		/**
		 * List all integrations for the current organization.
		 */
		list: {
			method: "GET",
			path: "/integrations",
			responses: {
				200: z.object({
					github: z.object({ connected: z.boolean() }),
					sentry: z.object({ connected: z.boolean() }),
					linear: z.object({ connected: z.boolean() }),
					integrations: z.array(IntegrationWithCreatorSchema),
					byProvider: z.object({
						github: z.array(IntegrationWithCreatorSchema),
						sentry: z.array(IntegrationWithCreatorSchema),
						linear: z.array(IntegrationWithCreatorSchema),
					}),
				}),
				401: ErrorResponseSchema,
				400: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List all integrations for the organization",
		},

		/**
		 * Update an integration (e.g., rename display name).
		 */
		update: {
			method: "PATCH",
			path: "/integrations/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: z.object({
				displayName: z.string(),
			}),
			responses: {
				200: z.object({ integration: IntegrationSchema }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Update an integration display name",
		},

		/**
		 * Save integration after Nango OAuth callback.
		 */
		callback: {
			method: "POST",
			path: "/integrations/callback",
			body: z.object({
				connectionId: z.string(),
				providerConfigKey: z.string(),
			}),
			responses: {
				200: z.object({ success: z.boolean() }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Save integration connection from Nango callback",
		},

		/**
		 * Disconnect an integration.
		 */
		disconnect: {
			method: "POST",
			path: "/integrations/disconnect",
			body: z.object({
				integrationId: z.string().uuid(),
			}),
			responses: {
				200: z.object({ success: z.boolean() }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Disconnect an integration",
		},

		// ----------------------------------------
		// GitHub endpoints
		// ----------------------------------------

		/**
		 * Get GitHub App connection status.
		 */
		githubStatus: {
			method: "GET",
			path: "/integrations/github/status",
			responses: {
				200: GitHubStatusSchema,
				401: ErrorResponseSchema,
			},
			summary: "Get GitHub App connection status",
		},

		/**
		 * Create a Nango connect session for GitHub OAuth.
		 * Only available when USE_NANGO_GITHUB is enabled.
		 */
		githubSession: {
			method: "POST",
			path: "/integrations/github/session",
			body: c.noBody(),
			responses: {
				200: z.object({ sessionToken: z.string() }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Create Nango connect session for GitHub OAuth",
		},

		// ----------------------------------------
		// Sentry endpoints
		// ----------------------------------------

		/**
		 * Get Sentry connection status.
		 */
		sentryStatus: {
			method: "GET",
			path: "/integrations/sentry/status",
			responses: {
				200: ProviderStatusSchema,
				401: ErrorResponseSchema,
			},
			summary: "Get Sentry connection status",
		},

		/**
		 * Create a Nango connect session for Sentry OAuth.
		 */
		sentrySession: {
			method: "POST",
			path: "/integrations/sentry/session",
			body: c.noBody(),
			responses: {
				200: z.object({ sessionToken: z.string() }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Create Nango connect session for Sentry OAuth",
		},

		/**
		 * Get Sentry metadata (projects, environments, levels).
		 */
		sentryMetadata: {
			method: "GET",
			path: "/integrations/sentry/metadata",
			query: z.object({
				connectionId: z.string(),
				projectSlug: z.string().optional(),
			}),
			responses: {
				200: SentryMetadataSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Get Sentry projects and environments",
		},

		// ----------------------------------------
		// Linear endpoints
		// ----------------------------------------

		/**
		 * Get Linear connection status.
		 */
		linearStatus: {
			method: "GET",
			path: "/integrations/linear/status",
			responses: {
				200: ProviderStatusSchema,
				401: ErrorResponseSchema,
			},
			summary: "Get Linear connection status",
		},

		/**
		 * Create a Nango connect session for Linear OAuth.
		 */
		linearSession: {
			method: "POST",
			path: "/integrations/linear/session",
			body: c.noBody(),
			responses: {
				200: z.object({ sessionToken: z.string() }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Create Nango connect session for Linear OAuth",
		},

		/**
		 * Get Linear metadata (teams, states, labels, users, projects).
		 */
		linearMetadata: {
			method: "GET",
			path: "/integrations/linear/metadata",
			query: z.object({
				connectionId: z.string(),
				teamId: z.string().optional(),
			}),
			responses: {
				200: LinearMetadataSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Get Linear teams, states, labels, users, and projects",
		},

		// ----------------------------------------
		// Slack endpoints
		// ----------------------------------------

		/**
		 * Get Slack connection status.
		 */
		slackStatus: {
			method: "GET",
			path: "/integrations/slack/status",
			responses: {
				200: SlackStatusSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
			},
			summary: "Get Slack connection status",
		},

		/**
		 * Send a Slack Connect invite.
		 */
		slackConnect: {
			method: "POST",
			path: "/integrations/slack/connect",
			body: z.object({
				channelName: z.string(),
			}),
			responses: {
				200: z.object({
					ok: z.boolean(),
					channel_id: z.string(),
					invite_id: z.string(),
					invite_url: z.string(),
				}),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Send a Slack Connect invite",
		},

		/**
		 * Disconnect Slack.
		 */
		slackDisconnect: {
			method: "POST",
			path: "/integrations/slack/disconnect",
			body: c.noBody(),
			responses: {
				200: z.object({ success: z.boolean() }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Disconnect Slack integration",
		},
	},
	{
		pathPrefix: "/api",
	},
);
