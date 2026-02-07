/**
 * CLI oRPC router.
 *
 * Handles CLI authentication, SSH keys, repos, sessions, GitHub, and prebuilds.
 */

import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";

const log = logger.child({ handler: "cli" });
import { checkCanConnectCLI, checkCanResumeSession } from "@/lib/billing";
import { getSessionGatewayUrl } from "@/lib/gateway";
import { getGitHubTokenForIntegration } from "@/lib/github";
import getNango, { NANGO_GITHUB_INTEGRATION_ID, requireNangoIntegrationId } from "@/lib/nango";
import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { cli } from "@proliferate/services";
import type { SandboxProviderType } from "@proliferate/shared";
import {
	CliPrebuildSchema,
	CliRepoConnectionSchema,
	CliRepoSchema,
	CliSessionSchema,
	CreateCliSessionInputSchema,
	CreateCliSessionResponseSchema,
	SshKeySchema,
} from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";
import { headers } from "next/headers";
import { z } from "zod";
import { orgProcedure, protectedProcedure, publicProcedure } from "./middleware";

// ============================================
// Repos Router
// ============================================

export const cliReposRouter = {
	/**
	 * Get local repo by path hash.
	 */
	get: orgProcedure
		.input(z.object({ localPathHash: z.string() }))
		.output(
			z.object({
				repo: CliRepoSchema.nullable(),
				connection: CliRepoConnectionSchema.nullable(),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await cli.getLocalRepo(context.orgId, input.localPathHash);
			return {
				repo: result.repo
					? {
							id: result.repo.id,
							localPathHash: result.repo.localPathHash,
							displayName: result.repo.displayName,
						}
					: null,
				connection: result.connection
					? {
							id: result.connection.id,
							integrationId: result.connection.integrationId || "",
							integration: result.connection.integration,
						}
					: null,
			};
		}),

	/**
	 * Create a local repo and optionally link to integration.
	 */
	create: orgProcedure
		.input(
			z.object({
				localPathHash: z.string(),
				displayName: z.string().optional(),
				integrationId: z.string().optional(),
			}),
		)
		.output(
			z.object({
				success: z.boolean(),
				repoId: z.string().uuid(),
				integrationId: z.string().nullable(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Validate integration if provided
			if (input.integrationId && input.integrationId !== "local-git") {
				const exists = await cli.integrationExistsForOrg(input.integrationId, context.orgId);
				if (!exists) {
					throw new ORPCError("NOT_FOUND", { message: "Integration not found" });
				}
			}

			const result = await cli.upsertLocalRepo(
				context.orgId,
				context.user.id,
				input.localPathHash,
				input.displayName,
				input.integrationId,
			);

			return {
				success: true,
				repoId: result.repoId,
				integrationId: result.integrationId,
			};
		}),

	/**
	 * Delete all local repos for the organization.
	 */
	deleteAll: orgProcedure
		.output(z.object({ success: z.boolean(), deleted: z.number() }))
		.handler(async ({ context }) => {
			const count = await cli.deleteAllLocalRepos(context.orgId);
			return { success: true, deleted: count };
		}),
};

// ============================================
// Auth Router
// ============================================

export const cliAuthRouter = {
	/**
	 * Create a new device authorization request.
	 */
	createDeviceCode: publicProcedure
		.output(
			z.object({
				userCode: z.string(),
				deviceCode: z.string(),
				verificationUrl: z.string(),
				expiresIn: z.number(),
				interval: z.number(),
			}),
		)
		.handler(async () => {
			const devUserId = env.DEV_USER_ID;
			const result = await cli.createDeviceCode(devUserId);

			if (devUserId) {
				log.info({ devUserId }, "DEV_USER_ID bypass: auto-approved");
			}

			// Get headers from Next.js headers() function
			const reqHeaders = await headers();
			const forwardedHost = reqHeaders.get("x-forwarded-host");
			const forwardedProto = reqHeaders.get("x-forwarded-proto") || "https";
			const hostHeader = reqHeaders.get("host");

			let baseUrl: string;
			if (forwardedHost) {
				baseUrl = `${forwardedProto}://${forwardedHost}`;
			} else if (hostHeader && !hostHeader.includes("localhost")) {
				baseUrl = `https://${hostHeader}`;
			} else {
				baseUrl = env.NEXT_PUBLIC_APP_URL;
			}

			return {
				userCode: result.userCode,
				deviceCode: result.deviceCode,
				verificationUrl: `${baseUrl}/device?code=${result.userCode}`,
				expiresIn: result.expiresIn,
				interval: result.interval,
			};
		}),

	/**
	 * Authorize a device code (called from /device page).
	 */
	authorizeDevice: protectedProcedure
		.input(z.object({ userCode: z.string() }))
		.output(z.object({ success: z.boolean(), message: z.string() }))
		.handler(async ({ input, context }) => {
			const result = await cli.authorizeDeviceCode(
				input.userCode,
				context.user.id,
				context.session.activeOrganizationId,
			);

			if (!result.success) {
				throw new ORPCError("BAD_REQUEST", { message: result.error! });
			}

			return {
				success: true,
				message: "Device authorized! You can close this window.",
			};
		}),

	/**
	 * Poll for device authorization status.
	 */
	pollDevice: publicProcedure
		.input(z.object({ deviceCode: z.string() }))
		.output(
			z.object({
				token: z.string(),
				user: z.object({
					id: z.string().nullable(),
					email: z.string().nullable(),
					name: z.string().nullable(),
				}),
				org: z.object({
					id: z.string().nullable(),
					name: z.string().nullable(),
				}),
				hasGitHubConnection: z.boolean(),
			}),
		)
		.handler(async ({ input }) => {
			const pollResult = await cli.pollDeviceCode(input.deviceCode);

			if (pollResult.status === "invalid") {
				throw new ORPCError("BAD_REQUEST", { message: "invalid_device_code" });
			}
			if (pollResult.status === "expired") {
				throw new ORPCError("BAD_REQUEST", { message: "expired_token" });
			}
			if (pollResult.status === "pending") {
				throw new ORPCError("BAD_REQUEST", { message: "authorization_pending" });
			}

			// Status is "authorized"
			const codeData = pollResult.codeData!;

			// Create API key
			const apiKeyResult = await auth.api.createApiKey({
				body: {
					name: "cli-token",
					userId: codeData.user_id!,
					expiresIn: undefined,
				},
			});

			const integrationIds = ["github-app"];
			if (env.NEXT_PUBLIC_INTEGRATIONS_ENABLED) {
				integrationIds.push(requireNangoIntegrationId("github"));
			}
			const result = await cli.completeDeviceAuthorization(codeData, integrationIds);

			return {
				token: apiKeyResult.key,
				user: result.user,
				org: result.org,
				hasGitHubConnection: result.hasGitHubConnection,
			};
		}),
};

// ============================================
// SSH Keys Router
// ============================================

export const cliSshKeysRouter = {
	/**
	 * List all SSH keys for the user.
	 */
	list: protectedProcedure
		.output(z.object({ keys: z.array(SshKeySchema) }))
		.handler(async ({ context }) => {
			const keys = await cli.listSshKeys(context.user.id);
			return { keys };
		}),

	/**
	 * Upload a new SSH public key.
	 */
	create: protectedProcedure
		.input(z.object({ publicKey: z.string(), name: z.string().optional() }))
		.output(z.object({ key: SshKeySchema }))
		.handler(async ({ input, context }) => {
			try {
				const key = await cli.createSshKey(context.user.id, input.publicKey, input.name);
				return { key };
			} catch (err) {
				if (err instanceof Error && err.message.includes("Invalid SSH")) {
					throw new ORPCError("BAD_REQUEST", { message: err.message });
				}
				// Check for unique constraint violation
				const errCode = (err as { code?: string })?.code;
				if (errCode === "23505") {
					throw new ORPCError("CONFLICT", { message: "This SSH key is already registered" });
				}
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create SSH key" });
			}
		}),

	/**
	 * Delete all SSH keys for the user.
	 */
	deleteAll: protectedProcedure
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ context }) => {
			await cli.deleteAllSshKeys(context.user.id);
			return { success: true };
		}),

	/**
	 * Delete a specific SSH key by ID.
	 */
	delete: protectedProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			const deleted = await cli.deleteSshKey(input.id, context.user.id);
			if (!deleted) {
				throw new ORPCError("NOT_FOUND", { message: "SSH key not found" });
			}
			return { success: true };
		}),
};

// ============================================
// Sessions Router
// ============================================

export const cliSessionsRouter = {
	/**
	 * List CLI sessions.
	 */
	list: orgProcedure
		.input(z.object({ localPathHash: z.string().optional() }).optional())
		.output(z.object({ sessions: z.array(CliSessionSchema) }))
		.handler(async ({ input, context }) => {
			const sessions = await cli.listCliSessions(context.orgId, input?.localPathHash);
			return { sessions };
		}),

	/**
	 * Create a new terminal session or resume an existing one.
	 */
	create: orgProcedure
		.input(CreateCliSessionInputSchema)
		.output(CreateCliSessionResponseSchema)
		.handler(async ({ input, context }) => {
			const {
				localPathHash,
				localPath,
				resume,
				snapshotId,
				gitAuth,
				githubConnectionId,
				envVars,
				cloneInstructions,
			} = input;

			// Billing gate: resume vs new CLI session
			if (resume) {
				const billingCheck = await checkCanResumeSession(context.orgId);
				if (!billingCheck.allowed) {
					throw new ORPCError("PAYMENT_REQUIRED", {
						message: billingCheck.message || "Insufficient credits",
						data: { billingCode: billingCheck.code },
					});
				}
			} else {
				const billingCheck = await checkCanConnectCLI(context.orgId);
				if (!billingCheck.allowed) {
					throw new ORPCError("PAYMENT_REQUIRED", {
						message: billingCheck.message || "Insufficient credits",
						data: { billingCode: billingCheck.code },
					});
				}
			}

			if (resume) {
				const resumable = await cli.findResumableSession(context.orgId, localPathHash);
				if (resumable) {
					return {
						sessionId: resumable.sessionId,
						resumed: true,
						status: resumable.status,
					};
				}
			}

			// Get user's SSH keys
			const sshKeys = await cli.getSshPublicKeys(context.user.id);

			if (sshKeys.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "No SSH keys registered. Run 'proliferate --login' first.",
				});
			}

			const sessionId = randomUUID();
			const _gatewayUrl = getSessionGatewayUrl(sessionId);
			const provider = getSandboxProvider();

			// Get GitHub token if needed
			let githubToken: string | undefined;
			if (gitAuth === "proliferate" && githubConnectionId) {
				const integration = await cli.getGitHubIntegrationForToken(
					context.orgId,
					githubConnectionId,
				);

				if (!integration) {
					throw new ORPCError("FORBIDDEN", {
						message: "GitHub connection is not valid for this organization.",
					});
				}

				try {
					githubToken = await getGitHubTokenForIntegration({
						id: integration.id,
						githubInstallationId: integration.github_installation_id,
						connectionId: integration.connection_id,
					});
				} catch (err) {
					log.error({ err }, "Failed to get GitHub token");
					throw new ORPCError("INTERNAL_SERVER_ERROR", {
						message: "Failed to fetch GitHub credentials. Please reconnect GitHub.",
					});
				}
			}

			// Create session in DB
			try {
				await cli.createCliSession({
					id: sessionId,
					repoId: null,
					organizationId: context.orgId,
					createdBy: context.user.id,
					sessionType: "terminal",
					origin: "cli",
					localPathHash,
					status: "starting",
					sandboxProvider: provider.type,
					title: localPath ? `CLI: ${localPath}` : "CLI Session",
				});
			} catch {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" });
			}

			let sshHost: string | null = null;
			let sshPort: number | null = null;
			let previewUrl: string | null = null;
			let sandboxId: string | null = null;

			try {
				if (!provider.createTerminalSandbox) {
					throw new ORPCError("BAD_REQUEST", {
						message: `Provider ${provider.type} does not support terminal sessions`,
					});
				}

				const result = await provider.createTerminalSandbox({
					sessionId,
					userPublicKeys: sshKeys,
					localPath,
					snapshotId,
					gitToken: githubToken,
					envVars,
					cloneInstructions,
				});

				sandboxId = result.sandboxId;
				sshHost = result.sshHost;
				sshPort = result.sshPort;
				previewUrl = result.previewUrl;
			} catch (err) {
				await cli.deleteSession(sessionId);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: `Failed to create sandbox: ${err instanceof Error ? err.message : "Unknown error"}`,
				});
			}

			await cli.updateSessionWithSandbox(sessionId, sandboxId, "running", previewUrl);

			return {
				sessionId,
				resumed: false,
				status: "running",
				provider: provider.type,
				sshHost,
				sshPort,
				previewUrl,
				sandboxId,
			};
		}),

	/**
	 * Terminate all CLI sessions for the organization.
	 */
	deleteAll: orgProcedure
		.output(z.object({ success: z.boolean(), terminated: z.number() }))
		.handler(async ({ context }) => {
			const sessions = await cli.getCliSessionsForTermination(context.orgId);

			const provider = getSandboxProvider();
			for (const session of sessions) {
				try {
					await provider.terminate(session.id, session.sandbox_id ?? undefined);
				} catch (err) {
					log.error({ err, sessionId: session.id }, "Failed to terminate session");
				}
			}

			try {
				await cli.stopAllCliSessions(context.orgId);
			} catch (err) {
				log.error({ err }, "Error stopping CLI sessions");
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to stop sessions" });
			}

			return { success: true, terminated: sessions.length };
		}),

	/**
	 * Get a specific CLI session's details.
	 */
	get: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ session: z.record(z.unknown()) }))
		.handler(async ({ input, context }) => {
			const session = await cli.getSessionByIdAndOrg(input.id, context.orgId);

			if (!session) {
				throw new ORPCError("NOT_FOUND", { message: "Session not found" });
			}

			return { session };
		}),

	/**
	 * Terminate a specific CLI session.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean(), message: z.string().optional() }))
		.handler(async ({ input, context }) => {
			const session = await cli.getSessionForTermination(input.id, context.orgId);

			if (!session) {
				throw new ORPCError("NOT_FOUND", { message: "Session not found" });
			}

			if (session.status === "stopped") {
				return { success: true, message: "Session already stopped" };
			}

			if (session.sandbox_id && session.status === "running") {
				try {
					const provider = getSandboxProvider(session.sandbox_provider as SandboxProviderType);
					await provider.terminate(session.id, session.sandbox_id);
				} catch (err) {
					log.error({ err, sessionId: input.id }, "Failed to terminate sandbox for session");
				}
			}

			try {
				await cli.stopSession(input.id);
			} catch {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to stop session" });
			}

			return { success: true };
		}),

	/**
	 * Check which sandboxes are still alive.
	 */
	checkSandboxes: protectedProcedure
		.input(z.object({ sandboxIds: z.array(z.string()) }))
		.output(z.object({ alive: z.array(z.string()), count: z.number() }))
		.handler(async ({ input }) => {
			if (input.sandboxIds.length === 0) {
				return { alive: [], count: 0 };
			}

			const provider = getSandboxProvider();

			if (!provider.checkSandboxes) {
				throw new ORPCError("NOT_IMPLEMENTED", {
					message: "Provider does not support checkSandboxes",
				});
			}

			const alive = await provider.checkSandboxes(input.sandboxIds);
			return { alive, count: alive.length };
		}),
};

// ============================================
// GitHub Router
// ============================================

export const cliGitHubRouter = {
	/**
	 * Check if the organization has a GitHub connection.
	 */
	status: orgProcedure
		.output(z.object({ connected: z.boolean(), username: z.string().nullable() }))
		.handler(async ({ context }) => {
			const providers = ["github-app", NANGO_GITHUB_INTEGRATION_ID].filter(Boolean) as string[];
			return cli.getGitHubStatus(context.orgId, providers);
		}),

	/**
	 * Create a Nango Connect Session for GitHub OAuth.
	 */
	connect: orgProcedure
		.output(z.object({ connectUrl: z.string(), endUserId: z.string() }))
		.handler(async ({ context }) => {
			const orgName = await cli.getOrganizationName(context.orgId);

			if (!orgName) {
				throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
			}

			const nango = getNango();
			const githubIntegrationId = requireNangoIntegrationId("github");
			const endUserId = `org_${context.orgId}`;

			const session = await nango.createConnectSession({
				end_user: {
					id: endUserId,
					email: context.user.email,
					display_name: context.user.name || context.user.email,
				},
				organization: {
					id: context.orgId,
					display_name: orgName,
				},
				allowed_integrations: [githubIntegrationId],
			});

			return {
				connectUrl: session.data.connect_link,
				endUserId,
			};
		}),

	/**
	 * Poll for GitHub connection status.
	 */
	connectStatus: orgProcedure
		.output(
			z.object({
				connected: z.boolean(),
				connectionId: z.string().optional(),
				error: z.string().optional(),
			}),
		)
		.handler(async ({ context }) => {
			// Check for recent selection
			const selection = await cli.checkCliGitHubSelection(context.user.id, context.orgId);

			if (selection?.valid) {
				await cli.consumeCliGitHubSelection(context.user.id, context.orgId);
				return { connected: true, connectionId: selection.connectionId };
			}

			// Check for existing integration
			const providers = ["github-app", NANGO_GITHUB_INTEGRATION_ID].filter(Boolean) as string[];
			const integration = await cli.getActiveIntegrationByProviders(context.orgId, providers);

			if (integration) {
				return { connected: true, connectionId: integration.id };
			}

			if (!env.NEXT_PUBLIC_INTEGRATIONS_ENABLED) {
				return { connected: false, error: "Integrations are disabled" };
			}

			const githubIntegrationId = NANGO_GITHUB_INTEGRATION_ID;
			if (!githubIntegrationId) {
				return { connected: false, error: "Nango GitHub integration not configured" };
			}

			// Check Nango for connections
			const endUserId = `org_${context.orgId}`;

			try {
				const nango = getNango();
				const listed = await nango.listConnections();
				const orgConnections = (listed.connections ?? []).filter(
					(c) => c.provider_config_key === githubIntegrationId && c.end_user?.id === endUserId,
				);

				if (orgConnections.length === 0) {
					return { connected: false };
				}

				const sorted = orgConnections.sort(
					(a, b) => new Date(b.created).getTime() - new Date(a.created).getTime(),
				);
				const newest = sorted[0];

				// Verify credentials
				const connection = await nango.getConnection(githubIntegrationId, newest.connection_id);

				const credentials = connection.credentials as { access_token?: string };
				if (!credentials?.access_token) {
					return {
						connected: false,
						error: "Connection exists but no access token available",
					};
				}

				return { connected: true, connectionId: newest.connection_id };
			} catch (err) {
				log.error({ err }, "Failed to check GitHub connection status");
				return { connected: false, error: "Failed to check connection status" };
			}
		}),

	/**
	 * Store user's GitHub connection selection for CLI polling.
	 */
	select: orgProcedure
		.input(z.object({ connectionId: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			try {
				await cli.storeCliGitHubSelection(context.user.id, context.orgId, input.connectionId);
			} catch (err) {
				log.error({ err }, "Failed to store GitHub selection");
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to store selection" });
			}

			return { success: true };
		}),
};

// ============================================
// Prebuilds Router
// ============================================

export const cliPrebuildsRouter = {
	/**
	 * Look up prebuild by local path hash.
	 */
	get: protectedProcedure
		.input(z.object({ localPathHash: z.string() }))
		.output(z.object({ prebuild: CliPrebuildSchema.nullable() }))
		.handler(async ({ input, context }) => {
			const prebuild = await cli.getCliPrebuild(context.user.id, input.localPathHash);
			return { prebuild };
		}),

	/**
	 * Create or update a prebuild (snapshot cache).
	 */
	create: protectedProcedure
		.input(z.object({ localPathHash: z.string(), sessionId: z.string(), sandboxId: z.string() }))
		.output(z.object({ prebuild: CliPrebuildSchema, snapshotId: z.string() }))
		.handler(async ({ input, context }) => {
			const { localPathHash, sessionId, sandboxId } = input;
			const provider = getSandboxProvider();

			try {
				log.info({ sessionId }, "Taking snapshot of session");
				const snapshotResult = await provider.snapshot(sessionId, sandboxId);
				log.info({ snapshotId: snapshotResult.snapshotId }, "Snapshot created");

				const prebuild = await cli.upsertCliPrebuild(
					context.user.id,
					localPathHash,
					snapshotResult.snapshotId,
					provider.type,
				);

				return {
					prebuild,
					snapshotId: snapshotResult.snapshotId,
				};
			} catch (err) {
				log.error({ err }, "Error creating snapshot");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: `Failed to create snapshot: ${err instanceof Error ? err.message : "Unknown error"}`,
				});
			}
		}),

	/**
	 * Delete a prebuild by local path hash.
	 */
	delete: protectedProcedure
		.input(z.object({ localPathHash: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			await cli.deleteCliPrebuild(context.user.id, input.localPathHash);
			return { success: true };
		}),
};

// ============================================
// Combined CLI Router
// ============================================

export const cliRouter = {
	repos: cliReposRouter,
	auth: cliAuthRouter,
	sshKeys: cliSshKeysRouter,
	sessions: cliSessionsRouter,
	github: cliGitHubRouter,
	prebuilds: cliPrebuildsRouter,
};
