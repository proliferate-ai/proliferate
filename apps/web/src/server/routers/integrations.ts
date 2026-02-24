/**
 * Integrations oRPC router.
 *
 * Thin wrapper that delegates to integrations service.
 * Handles integration management for GitHub, Slack, Sentry, Linear, and MCP connectors.
 */

import { isEmailEnabled, sendIntegrationRequestEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import {
	NANGO_GITHUB_INTEGRATION_ID,
	NANGO_JIRA_INTEGRATION_ID,
	NANGO_LINEAR_INTEGRATION_ID,
	NANGO_SENTRY_INTEGRATION_ID,
	USE_NANGO_GITHUB,
	requireNangoIntegrationId,
} from "@/lib/nango";
import { sendSlackConnectInvite } from "@/lib/slack";
import { ORPCError } from "@orpc/server";
import {
	actions,
	connectors,
	integrations,
	secrets,
} from "@proliferate/services";
import {
	ConnectorAuthSchema,
	ConnectorConfigSchema,
	ConnectorRiskPolicySchema,
	GitHubStatusSchema,
	IntegrationSchema,
	IntegrationWithCreatorSchema,
	JiraMetadataSchema,
	LinearMetadataSchema,
	SentryMetadataSchema,
	SlackStatusSchema,
} from "@proliferate/shared";
import type { ConnectorConfig } from "@proliferate/shared";
import { z } from "zod";
import { orgProcedure } from "./middleware";

const log = logger.child({ handler: "integrations" });

/**
 * Translate service-layer errors to ORPCError.
 */
function throwAsORPC(err: unknown): never {
	if (err instanceof integrations.IntegrationNotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: err.message });
	}
	if (err instanceof integrations.IntegrationInactiveError) {
		throw new ORPCError("BAD_REQUEST", { message: err.message });
	}
	if (err instanceof integrations.NangoApiError) {
		throw new ORPCError("BAD_REQUEST", { message: err.message });
	}
	if (err instanceof integrations.NoAccessTokenError) {
		throw new ORPCError("BAD_REQUEST", { message: err.message });
	}
	if (err instanceof integrations.IntegrationAdminRequiredError) {
		throw new ORPCError("FORBIDDEN", { message: err.message });
	}
	if (err instanceof integrations.SlackConfigValidationError) {
		throw new ORPCError("BAD_REQUEST", { message: err.message });
	}
	if (err instanceof Error && err.message === "Organization not found") {
		throw new ORPCError("NOT_FOUND", { message: err.message });
	}
	throw err;
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
			if (!isEmailEnabled()) {
				log.warn("Email not configured, skipping integration request email");
				return { success: true };
			}

			const org = await integrations.getOrganizationForSession(context.orgId);

			try {
				await sendIntegrationRequestEmail({
					userName: context.user.name || context.user.email,
					userEmail: context.user.email,
					orgName: org?.name || context.orgId,
					integrationName: input.integrationName,
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
				jira: z.object({ connected: z.boolean() }),
				integrations: z.array(IntegrationWithCreatorSchema),
				byProvider: z.object({
					github: z.array(IntegrationWithCreatorSchema),
					sentry: z.array(IntegrationWithCreatorSchema),
					linear: z.array(IntegrationWithCreatorSchema),
					jira: z.array(IntegrationWithCreatorSchema),
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
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
			} catch (err) {
				throwAsORPC(err);
			}
			const displayName = integrations.getDisplayNameForProvider(input.providerConfigKey);

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
			try {
				await integrations.disconnectIntegrationWithNango(
					input.integrationId,
					context.orgId,
					context.user.id,
				);
				return { success: true };
			} catch (err) {
				throwAsORPC(err);
			}
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
			if (!USE_NANGO_GITHUB) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Nango GitHub OAuth is not enabled. Use GitHub App flow instead.",
				});
			}
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
				return await integrations.createNangoConnectSession({
					provider: "github",
					orgId: context.orgId,
					userId: context.user.id,
					userEmail: context.user.email,
					userDisplayName: context.user.name || context.user.email,
				});
			} catch (err) {
				throwAsORPC(err);
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
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
				return await integrations.createNangoConnectSession({
					provider: "sentry",
					orgId: context.orgId,
					userId: context.user.id,
					userEmail: context.user.email,
					userDisplayName: context.user.name || context.user.email,
				});
			} catch (err) {
				throwAsORPC(err);
			}
		}),

	/**
	 * Get Sentry metadata (projects, environments, levels).
	 */
	sentryMetadata: orgProcedure
		.input(z.object({ connectionId: z.string(), projectSlug: z.string().optional() }))
		.output(SentryMetadataSchema)
		.handler(async ({ input, context }) => {
			try {
				return await integrations.getSentryMetadata(
					input.connectionId,
					context.orgId,
					input.projectSlug,
				);
			} catch (err) {
				throwAsORPC(err);
			}
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
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
				return await integrations.createNangoConnectSession({
					provider: "linear",
					orgId: context.orgId,
					userId: context.user.id,
					userEmail: context.user.email,
					userDisplayName: context.user.name || context.user.email,
				});
			} catch (err) {
				throwAsORPC(err);
			}
		}),

	/**
	 * Get Linear metadata (teams, states, labels, users, projects).
	 */
	linearMetadata: orgProcedure
		.input(z.object({ connectionId: z.string(), teamId: z.string().optional() }))
		.output(LinearMetadataSchema)
		.handler(async ({ input, context }) => {
			try {
				return await integrations.getLinearMetadata(
					input.connectionId,
					context.orgId,
					input.teamId,
				);
			} catch (err) {
				throwAsORPC(err);
			}
		}),

	// ----------------------------------------
	// Jira endpoints
	// ----------------------------------------

	/**
	 * Get Jira connection status.
	 */
	jiraStatus: orgProcedure
		.output(z.object({ connected: z.boolean() }))
		.handler(async ({ context }) => {
			const jiraIntegrationId = requireNangoIntegrationId("jira");
			return integrations.getJiraStatus(context.orgId, jiraIntegrationId);
		}),

	/**
	 * Create a Nango connect session for Jira OAuth.
	 */
	jiraSession: orgProcedure
		.output(z.object({ sessionToken: z.string() }))
		.handler(async ({ context }) => {
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
				return await integrations.createNangoConnectSession({
					provider: "jira",
					orgId: context.orgId,
					userId: context.user.id,
					userEmail: context.user.email,
					userDisplayName: context.user.name || context.user.email,
				});
			} catch (err) {
				throwAsORPC(err);
			}
		}),

	/**
	 * Get Jira metadata (sites, projects, issue types).
	 */
	jiraMetadata: orgProcedure
		.input(
			z.object({
				connectionId: z.string(),
				siteId: z.string().optional(),
				projectId: z.string().optional(),
			}),
		)
		.output(JiraMetadataSchema)
		.handler(async ({ input, context }) => {
			try {
				return await integrations.getJiraMetadata(
					input.connectionId,
					context.orgId,
					input.siteId,
					input.projectId,
				);
			} catch (err) {
				throwAsORPC(err);
			}
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
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
			} catch (err) {
				throwAsORPC(err);
			}

			const userEmail = await integrations.getUserEmail(context.user.id);
			if (!userEmail) {
				throw new ORPCError("BAD_REQUEST", { message: "Could not find user email" });
			}

			// sendSlackConnectInvite stays in web layer (uses web-specific env vars)
			const result = await sendSlackConnectInvite(userEmail, input.channelName);

			if (!result.ok) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: result.error ?? "Failed to send invite",
				});
			}

			await integrations.updateSlackSupportChannel(
				context.orgId,
				result.channel_id!,
				input.channelName,
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
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
				await integrations.disconnectSlack(context.orgId);
				return { success: true };
			} catch (err) {
				throwAsORPC(err);
			}
		}),

	/**
	 * Get Slack installation config (strategy + default config + allowed configs).
	 */
	slackConfig: orgProcedure
		.output(
			z.object({
				installationId: z.string().uuid().nullable(),
				strategy: z.string().nullable(),
				defaultConfigurationId: z.string().uuid().nullable(),
				allowedConfigurationIds: z.array(z.string().uuid()).nullable(),
			}),
		)
		.handler(async ({ context }) => {
			const config = await integrations.getSlackInstallationConfigForOrg(context.orgId);
			if (!config) {
				return {
					installationId: null,
					strategy: null,
					defaultConfigurationId: null,
					allowedConfigurationIds: null,
				};
			}
			return {
				installationId: config.installationId,
				strategy: config.defaultConfigSelectionStrategy,
				defaultConfigurationId: config.defaultConfigurationId,
				allowedConfigurationIds: config.allowedConfigurationIds,
			};
		}),

	/**
	 * Update Slack installation config strategy.
	 */
	updateSlackConfig: orgProcedure
		.input(
			z.object({
				installationId: z.string().uuid(),
				strategy: z.enum(["fixed", "agent_decide"]),
				defaultConfigurationId: z.string().uuid().nullable().optional(),
				allowedConfigurationIds: z.array(z.string().uuid()).nullable().optional(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
				await integrations.updateSlackConfigWithValidation({
					installationId: input.installationId,
					orgId: context.orgId,
					strategy: input.strategy,
					defaultConfigurationId: input.defaultConfigurationId,
					allowedConfigurationIds: input.allowedConfigurationIds,
				});
				return { success: true };
			} catch (err) {
				throwAsORPC(err);
			}
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
	 */
	createConnectorWithSecret: orgProcedure
		.input(
			z.object({
				presetKey: z.string().min(1),
				secretValue: z.string().min(1).optional(),
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
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
			} catch (err) {
				throwAsORPC(err);
			}
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
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
			} catch (err) {
				throwAsORPC(err);
			}
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
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
			} catch (err) {
				throwAsORPC(err);
			}
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
	 */
	deleteConnector: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
			} catch (err) {
				throwAsORPC(err);
			}
			const deleted = await connectors.deleteConnector(input.id, context.orgId);
			if (!deleted) {
				throw new ORPCError("NOT_FOUND", { message: "Connector not found" });
			}
			return { success: true };
		}),

	/**
	 * Validate an MCP connector by resolving its secret and calling tools/list.
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
			try {
				await integrations.assertIntegrationAdmin(context.user.id, context.orgId);
			} catch (err) {
				throwAsORPC(err);
			}

			const connector: ConnectorConfig = input.connector;

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

				const { zodToJsonSchema } = await import("@proliferate/providers/helpers/schema");
				const tools = result.actions.map((a) => {
					const schema = zodToJsonSchema(a.params);
					const properties = (schema.properties ?? {}) as Record<
						string,
						Record<string, unknown>
					>;
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

	/**
	 * List Slack workspace members for DM destination selector.
	 */
	slackMembers: orgProcedure
		.input(z.object({ installationId: z.string().uuid() }))
		.output(
			z.object({
				members: z.array(
					z.object({
						id: z.string(),
						name: z.string(),
						realName: z.string().nullable(),
						email: z.string().nullable(),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			const installation = await integrations.getSlackInstallationForNotifications(
				context.orgId,
				input.installationId,
			);
			if (!installation) {
				throw new ORPCError("NOT_FOUND", { message: "Slack installation not found" });
			}
			const members = await integrations.listSlackMembers(input.installationId);
			return { members };
		}),

	/**
	 * List Slack channels for notification channel selector.
	 */
	slackChannels: orgProcedure
		.input(z.object({ installationId: z.string().uuid() }))
		.output(
			z.object({
				channels: z.array(
					z.object({
						id: z.string(),
						name: z.string(),
						isPrivate: z.boolean(),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			const installation = await integrations.getSlackInstallationForNotifications(
				context.orgId,
				input.installationId,
			);
			if (!installation) {
				throw new ORPCError("NOT_FOUND", { message: "Slack installation not found" });
			}
			const channels = await integrations.listSlackChannels(input.installationId);
			return { channels };
		}),
};

