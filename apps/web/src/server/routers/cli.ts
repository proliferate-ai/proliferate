/**
 * CLI oRPC router.
 *
 * Handles CLI authentication, SSH keys, repos, sessions, GitHub, and configurations.
 */

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";

const log = logger.child({ handler: "cli" });
import { NANGO_GITHUB_INTEGRATION_ID, requireNangoIntegrationId } from "@/lib/nango";
import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { cli } from "@proliferate/services";
import {
	CliConfigurationSchema,
	CliRepoConnectionSchema,
	CliRepoSchema,
	CliSessionSchema,
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
	 * Note: auth.api.createApiKey() stays in the router (better-auth is web-only).
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

			// Create API key (better-auth is web-only, cannot move to services)
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
	 * Terminate all CLI sessions for the organization.
	 */
	deleteAll: orgProcedure
		.output(z.object({ success: z.boolean(), terminated: z.number() }))
		.handler(async ({ context }) => {
			const terminated = await cli.terminateAllCliSessions(context.orgId);
			return { success: true, terminated };
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
			try {
				return await cli.terminateCliSession(input.id, context.orgId);
			} catch (err) {
				if (err instanceof cli.CliSessionNotFoundError) {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				throw err;
			}
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
			try {
				return await cli.createGitHubConnectSession({
					orgId: context.orgId,
					userId: context.user.id,
					userEmail: context.user.email,
					userName: context.user.name || context.user.email,
				});
			} catch (err) {
				if (err instanceof Error && err.message === "Organization not found") {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				throw err;
			}
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
			return cli.checkGitHubConnectStatus(context.user.id, context.orgId);
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
// Configurations Router
// ============================================

export const cliConfigurationsRouter = {
	/**
	 * Look up configuration by local path hash.
	 */
	get: protectedProcedure
		.input(z.object({ localPathHash: z.string() }))
		.output(z.object({ configuration: CliConfigurationSchema.nullable() }))
		.handler(async ({ input, context }) => {
			const configuration = await cli.getCliConfiguration(context.user.id, input.localPathHash);
			return { configuration };
		}),

	/**
	 * Create or update a configuration (snapshot cache).
	 */
	create: protectedProcedure
		.input(z.object({ localPathHash: z.string(), sessionId: z.string(), sandboxId: z.string() }))
		.output(z.object({ configuration: CliConfigurationSchema, snapshotId: z.string() }))
		.handler(async ({ input, context }) => {
			try {
				return await cli.createCliSnapshot(
					context.user.id,
					input.localPathHash,
					input.sessionId,
					input.sandboxId,
				);
			} catch (err) {
				if (err instanceof cli.CliSnapshotError) {
					throw new ORPCError("INTERNAL_SERVER_ERROR", { message: err.message });
				}
				throw err;
			}
		}),

	/**
	 * Delete a configuration by local path hash.
	 */
	delete: protectedProcedure
		.input(z.object({ localPathHash: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			await cli.deleteCliConfiguration(context.user.id, input.localPathHash);
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
	configurations: cliConfigurationsRouter,
};
