/**
 * Integrations oRPC router.
 *
 * Handles integration management for GitHub, Slack, Sentry, and Linear.
 * All database operations are delegated to the integrations service.
 */

import { decrypt, getEncryptionKey } from "@/lib/crypto";
import getNango, {
	NANGO_GITHUB_INTEGRATION_ID,
	NANGO_LINEAR_INTEGRATION_ID,
	NANGO_SENTRY_INTEGRATION_ID,
	USE_NANGO_GITHUB,
	requireNangoIntegrationId,
} from "@/lib/nango";
import { revokeToken, sendSlackConnectInvite } from "@/lib/slack";
import { ORPCError } from "@orpc/server";
import { integrations } from "@proliferate/services";
import {
	GitHubStatusSchema,
	IntegrationSchema,
	IntegrationWithCreatorSchema,
	LinearMetadataSchema,
	SentryMetadataSchema,
	SlackStatusSchema,
} from "@proliferate/shared";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { orgProcedure } from "./middleware";

const log = logger.child({ handler: "integrations" });

const GITHUB_APP_PROVIDER = "github-app";

type NangoConnection = {
	credentials: unknown;
	connection_config?: unknown;
};

/**
 * Extract a useful error message from Nango SDK failures (which use axios internally).
 * Logs the full response body for debugging.
 */
function handleNangoError(err: unknown, operation: string): never {
	// Nango SDK uses axios internally; extract response details from AxiosError-shaped objects
	const axiosResponse = (err as { response?: { status?: number; data?: unknown } }).response;
	if (axiosResponse) {
		const { status, data } = axiosResponse;
		log.error({ status, data, operation }, "Nango API error");
		const message =
			(typeof data === "object" &&
			data !== null &&
			"error" in data &&
			typeof data.error === "string"
				? data.error
				: null) ??
			(typeof data === "object" &&
			data !== null &&
			"message" in data &&
			typeof data.message === "string"
				? data.message
				: null) ??
			`Nango API error (HTTP ${status})`;
		throw new ORPCError("BAD_REQUEST", { message: `${operation}: ${message}` });
	}
	throw err;
}

// Map Nango integration IDs to display names
const DISPLAY_NAMES: Record<string, string> = {
	github: "GitHub",
	sentry: "Sentry",
	linear: "Linear",
	...(NANGO_GITHUB_INTEGRATION_ID ? { [NANGO_GITHUB_INTEGRATION_ID]: "GitHub" } : {}),
	...(NANGO_SENTRY_INTEGRATION_ID ? { [NANGO_SENTRY_INTEGRATION_ID]: "Sentry" } : {}),
	...(NANGO_LINEAR_INTEGRATION_ID ? { [NANGO_LINEAR_INTEGRATION_ID]: "Linear" } : {}),
};

// Sentry severity levels
const SENTRY_LEVELS = ["debug", "info", "warning", "error", "fatal"] as const;

// ============================================
// External API helper functions
// ============================================

interface SentryProject {
	id: string;
	slug: string;
	name: string;
	platform: string | null;
}

interface SentryEnvironment {
	name: string;
}

interface SentryMetadata {
	projects: SentryProject[];
	environments: SentryEnvironment[];
	levels: string[];
}

async function fetchSentryMetadata(
	authToken: string,
	hostname: string,
	projectSlug?: string,
): Promise<SentryMetadata> {
	const baseUrl = `https://${hostname}/api/0`;

	// Get organizations
	const orgsResponse = await fetch(`${baseUrl}/organizations/`, {
		headers: { Authorization: `Bearer ${authToken}` },
	});

	if (!orgsResponse.ok) {
		throw new Error(`Sentry API error: ${orgsResponse.status}`);
	}

	const orgs = (await orgsResponse.json()) as Array<{ slug: string; name: string }>;

	if (orgs.length === 0) {
		return {
			projects: [],
			environments: [],
			levels: [...SENTRY_LEVELS],
		};
	}

	const orgSlug = orgs[0].slug;

	// Fetch projects
	const projectsResponse = await fetch(`${baseUrl}/organizations/${orgSlug}/projects/`, {
		headers: { Authorization: `Bearer ${authToken}` },
	});

	if (!projectsResponse.ok) {
		throw new Error(`Sentry projects API error: ${projectsResponse.status}`);
	}

	const projects = (await projectsResponse.json()) as SentryProject[];

	// Fetch environments
	let environments: SentryEnvironment[] = [];
	const targetProjectSlug = projectSlug || (projects.length > 0 ? projects[0].slug : null);

	if (targetProjectSlug) {
		const envsResponse = await fetch(
			`${baseUrl}/projects/${orgSlug}/${targetProjectSlug}/environments/`,
			{ headers: { Authorization: `Bearer ${authToken}` } },
		);

		if (envsResponse.ok) {
			environments = (await envsResponse.json()) as SentryEnvironment[];
		}
	}

	return {
		projects,
		environments,
		levels: [...SENTRY_LEVELS],
	};
}

interface LinearTeam {
	id: string;
	name: string;
	key: string;
}

interface LinearState {
	id: string;
	name: string;
	type: string;
	color: string;
}

interface LinearLabel {
	id: string;
	name: string;
	color: string;
}

interface LinearUser {
	id: string;
	name: string;
	email: string;
}

interface LinearProject {
	id: string;
	name: string;
}

interface LinearMetadata {
	teams: LinearTeam[];
	states: LinearState[];
	labels: LinearLabel[];
	users: LinearUser[];
	projects: LinearProject[];
}

async function fetchLinearMetadata(authToken: string, teamId?: string): Promise<LinearMetadata> {
	const query = `
		query LinearMetadata($teamId: ID) {
			teams {
				nodes {
					id
					name
					key
				}
			}
			workflowStates(filter: { team: { id: { eq: $teamId } } }) {
				nodes {
					id
					name
					type
					color
				}
			}
			issueLabels(filter: { team: { id: { eq: $teamId } } }) {
				nodes {
					id
					name
					color
				}
			}
			users {
				nodes {
					id
					name
					email
				}
			}
			projects {
				nodes {
					id
					name
				}
			}
		}
	`;

	const response = await fetch("https://api.linear.app/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${authToken}`,
		},
		body: JSON.stringify({
			query,
			variables: teamId ? { teamId } : {},
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Linear API error: ${response.status} - ${errorText}`);
	}

	const result = (await response.json()) as {
		data?: {
			teams?: { nodes: LinearTeam[] };
			workflowStates?: { nodes: LinearState[] };
			issueLabels?: { nodes: LinearLabel[] };
			users?: { nodes: LinearUser[] };
			projects?: { nodes: LinearProject[] };
		};
		errors?: Array<{ message: string }>;
	};

	if (result.errors?.length) {
		throw new Error(`Linear GraphQL error: ${result.errors[0].message}`);
	}

	return {
		teams: result.data?.teams?.nodes || [],
		states: result.data?.workflowStates?.nodes || [],
		labels: result.data?.issueLabels?.nodes || [],
		users: result.data?.users?.nodes || [],
		projects: result.data?.projects?.nodes || [],
	};
}

// ============================================
// Router
// ============================================

export const integrationsRouter = {
	/**
	 * List all integrations for the organization.
	 */
	list: orgProcedure
		.output(
			z.object({
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
		)
		.handler(async ({ context }) => {
			return integrations.listIntegrations(context.orgId, context.user.id);
		}),

	/**
	 * Update an integration display name.
	 */
	update: orgProcedure
		.input(z.object({ id: z.string().uuid(), displayName: z.string() }))
		.output(z.object({ integration: IntegrationSchema }))
		.handler(async ({ input, context }) => {
			const updated = await integrations.updateIntegration(
				input.id,
				context.orgId,
				input.displayName,
			);

			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: "Integration not found" });
			}

			return { integration: updated };
		}),

	/**
	 * Save integration after Nango OAuth callback.
	 */
	callback: orgProcedure
		.input(z.object({ connectionId: z.string(), providerConfigKey: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			const displayName = DISPLAY_NAMES[input.providerConfigKey] || input.providerConfigKey;

			const result = await integrations.saveIntegrationFromCallback({
				organizationId: context.orgId,
				userId: context.user.id,
				connectionId: input.connectionId,
				providerConfigKey: input.providerConfigKey,
				displayName,
			});

			return { success: result.success };
		}),

	/**
	 * Disconnect an integration.
	 */
	disconnect: orgProcedure
		.input(z.object({ integrationId: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			// Get the integration details first
			const integration = await integrations.getIntegration(input.integrationId, context.orgId);

			if (!integration) {
				throw new ORPCError("NOT_FOUND", { message: "Connection not found" });
			}

			const isGitHubApp = integration.provider === GITHUB_APP_PROVIDER;

			// For Nango-managed connections, delete from Nango first
			if (!isGitHubApp && integration.connection_id) {
				const nango = getNango();
				try {
					await nango.deleteConnection(integration.integration_id!, integration.connection_id);
				} catch (err) {
					handleNangoError(
						err,
						`deleteConnection(${integration.integration_id}, ${integration.connection_id})`,
					);
				}
			}

			// Delete from database and handle orphaned repos
			const result = await integrations.deleteIntegration(input.integrationId, context.orgId);

			if (!result.success) {
				if (result.error === "Access denied") {
					throw new ORPCError("FORBIDDEN", { message: result.error });
				}
				throw new ORPCError("NOT_FOUND", { message: result.error || "Connection not found" });
			}

			return { success: true };
		}),

	// ----------------------------------------
	// GitHub endpoints
	// ----------------------------------------

	/**
	 * Get GitHub App connection status.
	 */
	githubStatus: orgProcedure.output(GitHubStatusSchema).handler(async ({ context }) => {
		return integrations.getGitHubStatusWithCreator(context.orgId);
	}),

	/**
	 * Create a Nango connect session for GitHub OAuth.
	 */
	githubSession: orgProcedure
		.output(z.object({ sessionToken: z.string() }))
		.handler(async ({ context }) => {
			// Gate this endpoint behind the feature flag
			if (!USE_NANGO_GITHUB) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Nango GitHub OAuth is not enabled. Use GitHub App flow instead.",
				});
			}

			const org = await integrations.getOrganizationForSession(context.orgId);

			if (!org) {
				throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
			}

			const nango = getNango();
			const githubIntegrationId = requireNangoIntegrationId("github");

			try {
				const result = await nango.createConnectSession({
					end_user: {
						id: context.user.id,
						email: context.user.email,
						display_name: context.user.name || context.user.email,
					},
					organization: {
						id: context.orgId,
						display_name: org.name,
					},
					allowed_integrations: [githubIntegrationId],
				});

				return { sessionToken: result.data.token };
			} catch (err) {
				handleNangoError(err, `createConnectSession(github, integration=${githubIntegrationId})`);
			}
		}),

	// ----------------------------------------
	// Sentry endpoints
	// ----------------------------------------

	/**
	 * Get Sentry connection status.
	 */
	sentryStatus: orgProcedure
		.output(z.object({ connected: z.boolean() }))
		.handler(async ({ context }) => {
			const sentryIntegrationId = requireNangoIntegrationId("sentry");
			return integrations.getSentryStatus(context.orgId, sentryIntegrationId);
		}),

	/**
	 * Create a Nango connect session for Sentry OAuth.
	 */
	sentrySession: orgProcedure
		.output(z.object({ sessionToken: z.string() }))
		.handler(async ({ context }) => {
			const org = await integrations.getOrganizationForSession(context.orgId);

			if (!org) {
				throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
			}

			const nango = getNango();
			const sentryIntegrationId = requireNangoIntegrationId("sentry");

			try {
				const result = await nango.createConnectSession({
					end_user: {
						id: context.user.id,
						email: context.user.email,
						display_name: context.user.name || context.user.email,
					},
					organization: {
						id: context.orgId,
						display_name: org.name,
					},
					allowed_integrations: [sentryIntegrationId],
				});

				return { sessionToken: result.data.token };
			} catch (err) {
				handleNangoError(err, `createConnectSession(sentry, integration=${sentryIntegrationId})`);
			}
		}),

	/**
	 * Get Sentry metadata (projects, environments, levels).
	 */
	sentryMetadata: orgProcedure
		.input(z.object({ connectionId: z.string(), projectSlug: z.string().optional() }))
		.output(SentryMetadataSchema)
		.handler(async ({ input, context }) => {
			const { connectionId, projectSlug } = input;

			// Get the integration record
			const integration = await integrations.getIntegrationWithStatus(connectionId, context.orgId);

			if (!integration) {
				throw new ORPCError("NOT_FOUND", { message: "Integration not found" });
			}

			if (integration.status !== "active") {
				throw new ORPCError("BAD_REQUEST", { message: "Integration is not active" });
			}

			// Get credentials from Nango
			const nango = getNango();
			const sentryIntegrationId = requireNangoIntegrationId("sentry");
			let connection: NangoConnection;
			try {
				connection = await nango.getConnection(sentryIntegrationId, integration.connectionId!);
			} catch (err) {
				handleNangoError(err, `getConnection(sentry, connection=${integration.connectionId})`);
			}

			const credentials = connection.credentials as {
				access_token?: string;
				apiKey?: string;
			};
			const connectionConfig = connection.connection_config as { hostname?: string } | undefined;

			const authToken = credentials.apiKey || credentials.access_token;
			if (!authToken) {
				throw new ORPCError("BAD_REQUEST", { message: "No access token available" });
			}

			const hostname = connectionConfig?.hostname || "sentry.io";

			// Fetch metadata from Sentry API
			return fetchSentryMetadata(authToken, hostname, projectSlug);
		}),

	// ----------------------------------------
	// Linear endpoints
	// ----------------------------------------

	/**
	 * Get Linear connection status.
	 */
	linearStatus: orgProcedure
		.output(z.object({ connected: z.boolean() }))
		.handler(async ({ context }) => {
			const linearIntegrationId = requireNangoIntegrationId("linear");
			return integrations.getLinearStatus(context.orgId, linearIntegrationId);
		}),

	/**
	 * Create a Nango connect session for Linear OAuth.
	 */
	linearSession: orgProcedure
		.output(z.object({ sessionToken: z.string() }))
		.handler(async ({ context }) => {
			const org = await integrations.getOrganizationForSession(context.orgId);

			if (!org) {
				throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
			}

			const nango = getNango();
			const linearIntegrationId = requireNangoIntegrationId("linear");

			try {
				const result = await nango.createConnectSession({
					end_user: {
						id: context.user.id,
						email: context.user.email,
						display_name: context.user.name || context.user.email,
					},
					organization: {
						id: context.orgId,
						display_name: org.name,
					},
					allowed_integrations: [linearIntegrationId],
				});

				return { sessionToken: result.data.token };
			} catch (err) {
				handleNangoError(err, `createConnectSession(linear, integration=${linearIntegrationId})`);
			}
		}),

	/**
	 * Get Linear metadata (teams, states, labels, users, projects).
	 */
	linearMetadata: orgProcedure
		.input(z.object({ connectionId: z.string(), teamId: z.string().optional() }))
		.output(LinearMetadataSchema)
		.handler(async ({ input, context }) => {
			const { connectionId, teamId } = input;

			// Get the integration record
			const integration = await integrations.getIntegrationWithStatus(connectionId, context.orgId);

			if (!integration) {
				throw new ORPCError("NOT_FOUND", { message: "Integration not found" });
			}

			if (integration.status !== "active") {
				throw new ORPCError("BAD_REQUEST", { message: "Integration is not active" });
			}

			// Get credentials from Nango
			const nango = getNango();
			const linearIntegrationId = requireNangoIntegrationId("linear");
			let connection: NangoConnection;
			try {
				connection = await nango.getConnection(linearIntegrationId, integration.connectionId!);
			} catch (err) {
				handleNangoError(err, `getConnection(linear, connection=${integration.connectionId})`);
			}

			const credentials = connection.credentials as {
				access_token?: string;
				apiKey?: string;
			};

			const authToken = credentials.apiKey || credentials.access_token;
			if (!authToken) {
				throw new ORPCError("BAD_REQUEST", { message: "No access token available" });
			}

			// Fetch metadata from Linear GraphQL API
			return fetchLinearMetadata(authToken, teamId);
		}),

	// ----------------------------------------
	// Slack endpoints
	// ----------------------------------------

	/**
	 * Get Slack connection status.
	 */
	slackStatus: orgProcedure.output(SlackStatusSchema).handler(async ({ context }) => {
		return integrations.getSlackStatus(context.orgId);
	}),

	/**
	 * Send a Slack Connect invite.
	 */
	slackConnect: orgProcedure
		.input(z.object({ channelName: z.string() }))
		.output(
			z.object({
				ok: z.boolean(),
				channel_id: z.string(),
				invite_id: z.string(),
				invite_url: z.string(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { channelName } = input;

			// Get user email
			const userEmail = await integrations.getUserEmail(context.user.id);

			if (!userEmail) {
				throw new ORPCError("BAD_REQUEST", { message: "Could not find user email" });
			}

			// Send Slack Connect invite
			const result = await sendSlackConnectInvite(userEmail, channelName);

			if (!result.ok) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: result.error ?? "Failed to send invite",
				});
			}

			// Store the support channel info
			await integrations.updateSlackSupportChannel(
				context.orgId,
				result.channel_id!,
				channelName,
				result.invite_id!,
				result.invite_url!,
			);

			return {
				ok: true,
				channel_id: result.channel_id!,
				invite_id: result.invite_id!,
				invite_url: result.invite_url!,
			};
		}),

	/**
	 * Disconnect Slack.
	 */
	slackDisconnect: orgProcedure
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ context }) => {
			// Find active installation
			const installation = await integrations.getSlackInstallationForDisconnect(context.orgId);

			if (!installation) {
				throw new ORPCError("NOT_FOUND", { message: "No active Slack installation found" });
			}

			// Revoke token with Slack
			try {
				const botToken = decrypt(installation.encryptedBotToken, getEncryptionKey());
				await revokeToken(botToken);
			} catch (err) {
				log.error({ err }, "Failed to revoke Slack token");
				// Continue with local revocation even if Slack API fails
			}

			// Mark installation as revoked
			await integrations.revokeSlackInstallation(installation.id);

			return { success: true };
		}),
};
