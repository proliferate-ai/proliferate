/**
 * Integrations oRPC router.
 *
 * Handles integration management for GitHub, Slack, Sentry, and Linear.
 * All database operations are delegated to the integrations service.
 */

import { decrypt, getEncryptionKey } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import getNango, {
	NANGO_GITHUB_INTEGRATION_ID,
	NANGO_LINEAR_INTEGRATION_ID,
	NANGO_SENTRY_INTEGRATION_ID,
	USE_NANGO_GITHUB,
	requireNangoIntegrationId,
} from "@/lib/nango";
import { revokeToken, sendSlackConnectInvite } from "@/lib/slack";
import { ORPCError } from "@orpc/server";
import { actions, connectors, integrations, orgs, secrets } from "@proliferate/services";
import {
	ConnectorAuthSchema,
	ConnectorConfigSchema,
	ConnectorRiskPolicySchema,
	GitHubStatusSchema,
	IntegrationSchema,
	IntegrationWithCreatorSchema,
	LinearMetadataSchema,
	SentryMetadataSchema,
	SlackStatusSchema,
} from "@proliferate/shared";
import type { ConnectorConfig } from "@proliferate/shared";
import { z } from "zod";
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
	 * Request a new integration (sends email via Resend).
	 */
	requestIntegration: orgProcedure
		.input(z.object({ integrationName: z.string().min(1).max(200) }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			const { Resend } = await import("resend");
			const { env } = await import("@proliferate/environment/server");

			const apiKey = env.RESEND_API_KEY;
			const emailFrom = env.EMAIL_FROM;

			if (!apiKey || !emailFrom) {
				log.warn("RESEND_API_KEY or EMAIL_FROM not configured, skipping integration request email");
				return { success: true };
			}

			const resend = new Resend(apiKey);
			const org = await integrations.getOrganizationForSession(context.orgId);
			const orgName = org?.name;

			const userName = escapeHtml(context.user.name || context.user.email);
			const displayOrg = escapeHtml(orgName || context.orgId);
			const integrationName = escapeHtml(input.integrationName);
			const userEmail = escapeHtml(context.user.email);

			try {
				await resend.emails.send({
					from: emailFrom,
					to: emailFrom,
					subject: `Integration request: ${input.integrationName}`,
					html: `
						<p><strong>${userName}</strong> from <strong>${displayOrg}</strong> requested:</p>
						<p style="font-size: 18px; padding: 12px 0;">${integrationName}</p>
						<p style="color: #666;">User email: ${userEmail}</p>
					`,
				});
				log.info(
					{ orgId: context.orgId, userId: context.user.id, integration: input.integrationName },
					"Integration request email sent",
				);
			} catch (err) {
				log.error(
					{
						err,
						orgId: context.orgId,
						userId: context.user.id,
						integration: input.integrationName,
					},
					"Failed to send integration request email",
				);
			}

			return { success: true };
		}),

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
			await requireIntegrationAdmin(context.user.id, context.orgId);
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

			// Admin can disconnect anything; members can only disconnect their own
			const role = await orgs.getUserRole(context.user.id, context.orgId);
			const isAdmin = role === "owner" || role === "admin";
			if (!isAdmin && integration.created_by !== context.user.id) {
				throw new ORPCError("FORBIDDEN", {
					message: "Only admins or the creator can disconnect.",
				});
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
			await requireIntegrationAdmin(context.user.id, context.orgId);
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
			await requireIntegrationAdmin(context.user.id, context.orgId);
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
			await requireIntegrationAdmin(context.user.id, context.orgId);
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
	 * List active Slack installations for workspace selector.
	 */
	slackInstallations: orgProcedure
		.output(
			z.object({
				installations: z.array(
					z.object({
						id: z.string().uuid(),
						team_id: z.string(),
						team_name: z.string().nullable(),
					}),
				),
			}),
		)
		.handler(async ({ context }) => {
			const installations = await integrations.listActiveSlackInstallations(context.orgId);
			return {
				installations: installations.map((i) => ({
					id: i.id,
					team_id: i.teamId,
					team_name: i.teamName,
				})),
			};
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
			await requireIntegrationAdmin(context.user.id, context.orgId);
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
			await requireIntegrationAdmin(context.user.id, context.orgId);
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

	// ============================================
	// Org-Scoped MCP Connectors
	// ============================================

	/**
	 * List all MCP connectors for the organization.
	 */
	listConnectors: orgProcedure
		.output(z.object({ connectors: z.array(ConnectorConfigSchema) }))
		.handler(async ({ context }) => {
			const list = await connectors.listConnectors(context.orgId);
			return { connectors: list };
		}),

	/**
	 * Create a new MCP connector with an inline secret from a preset.
	 * Atomically provisions the secret and connector in one transaction.
	 * Restricted to admin/owner role.
	 */
	createConnectorWithSecret: orgProcedure
		.input(
			z.object({
				presetKey: z.string().min(1),
				/** Raw API key value. Omit to reuse an existing secret (secretKey required). */
				secretValue: z.string().min(1).optional(),
				/** Existing secret key to reuse, or override for the auto-generated key name. */
				secretKey: z.string().min(1).max(200).optional(),
				name: z.string().min(1).max(100).optional(),
				url: z.string().url().optional(),
				riskPolicy: ConnectorRiskPolicySchema.optional(),
			}),
		)
		.output(
			z.object({
				connector: ConnectorConfigSchema,
				resolvedSecretKey: z.string(),
			}),
		)
		.handler(async ({ input, context }) => {
			await requireIntegrationAdmin(context.user.id, context.orgId);
			try {
				return await connectors.createConnectorWithSecret({
					organizationId: context.orgId,
					createdBy: context.user.id,
					presetKey: input.presetKey,
					secretValue: input.secretValue,
					secretKey: input.secretKey,
					name: input.name,
					url: input.url,
					riskPolicy: input.riskPolicy,
				});
			} catch (err) {
				if (
					err instanceof connectors.PresetNotFoundError ||
					err instanceof connectors.ConnectorValidationError
				) {
					throw new ORPCError("BAD_REQUEST", { message: err.message });
				}
				throw err;
			}
		}),

	/**
	 * Create a new MCP connector.
	 * Restricted to admin/owner role.
	 */
	createConnector: orgProcedure
		.input(
			z.object({
				name: z.string().min(1).max(100),
				transport: z.literal("remote_http"),
				url: z.string().url(),
				auth: ConnectorAuthSchema,
				riskPolicy: ConnectorRiskPolicySchema.optional(),
				enabled: z.boolean(),
			}),
		)
		.output(z.object({ connector: ConnectorConfigSchema }))
		.handler(async ({ input, context }) => {
			await requireIntegrationAdmin(context.user.id, context.orgId);
			const connector = await connectors.createConnector({
				organizationId: context.orgId,
				name: input.name,
				transport: input.transport,
				url: input.url,
				auth: input.auth,
				riskPolicy: input.riskPolicy,
				enabled: input.enabled,
				createdBy: context.user.id,
			});
			return { connector };
		}),

	/**
	 * Update an existing MCP connector.
	 * Restricted to admin/owner role.
	 */
	updateConnector: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				name: z.string().min(1).max(100).optional(),
				url: z.string().url().optional(),
				auth: ConnectorAuthSchema.optional(),
				riskPolicy: ConnectorRiskPolicySchema.nullable().optional(),
				enabled: z.boolean().optional(),
			}),
		)
		.output(z.object({ connector: ConnectorConfigSchema.nullable() }))
		.handler(async ({ input, context }) => {
			await requireIntegrationAdmin(context.user.id, context.orgId);
			const connector = await connectors.updateConnector(input.id, context.orgId, {
				name: input.name,
				url: input.url,
				auth: input.auth,
				riskPolicy: input.riskPolicy,
				enabled: input.enabled,
			});
			if (!connector) {
				throw new ORPCError("NOT_FOUND", { message: "Connector not found" });
			}
			return { connector };
		}),

	/**
	 * Delete an MCP connector.
	 * Restricted to admin/owner role.
	 */
	deleteConnector: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			await requireIntegrationAdmin(context.user.id, context.orgId);
			const deleted = await connectors.deleteConnector(input.id, context.orgId);
			if (!deleted) {
				throw new ORPCError("NOT_FOUND", { message: "Connector not found" });
			}
			return { success: true };
		}),

	/**
	 * Validate an MCP connector by resolving its secret and calling tools/list.
	 * Returns discovered tool metadata and diagnostics.
	 * Restricted to admin/owner role.
	 */
	validateConnector: orgProcedure
		.input(z.object({ connector: ConnectorConfigSchema }))
		.output(
			z.object({
				ok: z.boolean(),
				tools: z.array(
					z.object({
						name: z.string(),
						description: z.string(),
						riskLevel: z.enum(["read", "write", "danger"]),
						params: z.array(
							z.object({
								name: z.string(),
								type: z.enum(["string", "number", "boolean", "object"]),
								required: z.boolean(),
								description: z.string(),
							}),
						),
					}),
				),
				error: z.string().nullable(),
				diagnostics: z
					.object({
						class: z.enum(["auth", "timeout", "unreachable", "protocol", "unknown"]),
						message: z.string(),
					})
					.nullable(),
			}),
		)
		.handler(async ({ input, context }) => {
			await requireIntegrationAdmin(context.user.id, context.orgId);

			const connector: ConnectorConfig = input.connector;

			// Resolve the secret
			const resolvedSecret = await secrets.resolveSecretValue(
				context.orgId,
				connector.auth.secretKey,
			);
			if (!resolvedSecret) {
				return {
					ok: false,
					tools: [],
					error: `Secret "${connector.auth.secretKey}" not found or could not be decrypted`,
					diagnostics: { class: "auth" as const, message: "Secret not found" },
				};
			}

			try {
				const result = await actions.connectors.listConnectorToolsOrThrow(
					connector,
					resolvedSecret,
				);

				if (result.actions.length === 0) {
					return {
						ok: false,
						tools: [],
						error: "Connected successfully but no tools were returned",
						diagnostics: {
							class: "protocol" as const,
							message: "Server returned zero tools from tools/list",
						},
					};
				}

				// Convert Zod-based ActionDefinitions to the oRPC response format
				const { zodToJsonSchema } = await import("@proliferate/providers/helpers/schema");
				const tools = result.actions.map((a) => {
					const schema = zodToJsonSchema(a.params);
					const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
					const requiredSet = new Set(
						Array.isArray(schema.required) ? (schema.required as string[]) : [],
					);
					return {
						name: a.id,
						description: a.description,
						riskLevel: a.riskLevel,
						params: Object.entries(properties).map(([name, prop]) => {
							const t = prop.type as string;
							const type: "string" | "number" | "boolean" | "object" =
								t === "string"
									? "string"
									: t === "number"
										? "number"
										: t === "boolean"
											? "boolean"
											: "object";
							return {
								name,
								type,
								required: requiredSet.has(name),
								description: (prop.description as string) ?? "",
							};
						}),
					};
				});

				return {
					ok: true,
					tools,
					error: null,
					diagnostics: null,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				let diagClass: "auth" | "timeout" | "unreachable" | "protocol" | "unknown" = "unknown";

				if (message.includes("timeout")) {
					diagClass = "timeout";
				} else if (
					message.includes("ECONNREFUSED") ||
					message.includes("ENOTFOUND") ||
					message.includes("fetch failed")
				) {
					diagClass = "unreachable";
				} else if (message.includes("401") || message.includes("403")) {
					diagClass = "auth";
				} else if (message.includes("JSON") || message.includes("parse")) {
					diagClass = "protocol";
				}

				log.warn({ err, connectorId: connector.id }, "Connector validation failed");
				return {
					ok: false,
					tools: [],
					error: message,
					diagnostics: { class: diagClass, message },
				};
			}
		}),
};

// ============================================
// Helpers
// ============================================

async function requireIntegrationAdmin(userId: string, orgId: string): Promise<void> {
	const role = await orgs.getUserRole(userId, orgId);
	if (role !== "owner" && role !== "admin") {
		throw new ORPCError("FORBIDDEN", { message: "Admin or owner role required" });
	}
}

/** Escape user-provided strings before embedding in HTML email templates. */
function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
