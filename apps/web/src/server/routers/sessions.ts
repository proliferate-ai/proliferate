/**
 * Sessions oRPC router.
 *
 * Handles session CRUD and lifecycle operations.
 * Note: Complex operations (create, pause, snapshot) require sandbox provider
 * integration and remain as separate handlers imported here.
 */

import { GATEWAY_URL } from "@/lib/infra/gateway";
import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { integrations, notifications, sessions } from "@proliferate/services";
import {
	CreateSessionInputSchema,
	CreateSessionResponseSchema,
	SessionSchema,
} from "@proliferate/shared";
import { z } from "zod";
import { billingGatedProcedure, orgProcedure, publicProcedure } from "./middleware";

async function createSessionOrThrow(input: {
	configurationId?: string;
	sessionType?: "setup" | "coding";
	modelId?: string;
	reasoningEffort?: "quick" | "normal" | "deep";
	initialPrompt?: string;
	orgId: string;
	userId: string;
	continuedFromSessionId?: string;
	rerunOfSessionId?: string;
}): Promise<sessions.CreateSessionResult> {
	try {
		return await sessions.createSession({
			configurationId: input.configurationId,
			sessionType: input.sessionType,
			modelId: input.modelId,
			reasoningEffort: input.reasoningEffort,
			initialPrompt: input.initialPrompt,
			orgId: input.orgId,
			userId: input.userId,
			gatewayUrl: GATEWAY_URL ?? "",
			serviceToken: env.SERVICE_TO_SERVICE_AUTH_TOKEN ?? "",
			continuedFromSessionId: input.continuedFromSessionId,
			rerunOfSessionId: input.rerunOfSessionId,
		});
	} catch (err) {
		if (err instanceof sessions.SessionLimitError) {
			throw new ORPCError("FORBIDDEN", { message: err.message });
		}
		if (err instanceof sessions.ConfigurationNotFoundError) {
			throw new ORPCError("BAD_REQUEST", { message: err.message });
		}
		if (err instanceof sessions.ConfigurationNoReposError) {
			throw new ORPCError("BAD_REQUEST", { message: err.message });
		}
		if (err instanceof sessions.ConfigurationRepoUnauthorizedError) {
			throw new ORPCError("UNAUTHORIZED", { message: err.message });
		}
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: err instanceof Error ? err.message : "Failed to create session",
		});
	}
}

export const sessionsRouter = {
	/**
	 * List all sessions for the current organization.
	 * When `enriched` is true, includes unread state, worker name, and pending approval counts.
	 */
	list: orgProcedure
		.input(
			z
				.object({
					repoId: z.string().uuid().optional(),
					status: z.string().optional(),
					kinds: z.array(z.enum(["manager", "task", "setup"])).optional(),
					limit: z.number().int().min(1).max(50).optional(),
					excludeSetup: z.boolean().optional(),
					excludeCli: z.boolean().optional(),
					excludeAutomation: z.boolean().optional(),
					createdBy: z.string().optional(),
					enriched: z.boolean().optional(),
				})
				.optional(),
		)
		.output(z.object({ sessions: z.array(SessionSchema) }))
		.handler(async ({ input, context }) => {
			const opts = {
				repoId: input?.repoId,
				status: input?.status,
				kinds: input?.kinds,
				limit: input?.limit,
				excludeSetup: input?.excludeSetup,
				excludeCli: input?.excludeCli,
				excludeAutomation: input?.excludeAutomation,
				createdBy: input?.createdBy,
				// K2: Pass userId for visibility + ACL filtering
				userId: context.user.id,
			};

			const sessionsList = input?.enriched
				? await sessions.listSessionsEnriched(context.orgId, context.user.id, opts)
				: await sessions.listSessions(context.orgId, opts);

			return { sessions: sessionsList };
		}),

	/**
	 * Get a single session by ID.
	 */
	get: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ session: SessionSchema }))
		.handler(async ({ input, context }) => {
			const session = await sessions.getSession(input.id, context.orgId);
			if (!session) {
				throw new ORPCError("NOT_FOUND", { message: "Session not found" });
			}
			return { session };
		}),

	/**
	 * Mark a session as viewed by the current user (clears unread state).
	 */
	markViewed: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			await sessions.markSessionViewed({ sessionId: input.id, userId: context.user.id });
			return { success: true };
		}),

	/**
	 * Create a follow-up session (continuation or rerun) from an existing session.
	 */
	createFollowUp: billingGatedProcedure
		.input(
			z.object({
				sourceSessionId: z.string().uuid(),
				mode: z.enum(["continuation", "rerun"]),
				initialPrompt: z.string().optional(),
			}),
		)
		.output(CreateSessionResponseSchema)
		.handler(async ({ input, context }) => {
			const source = await sessions.getSession(input.sourceSessionId, context.orgId);
			if (!source) {
				throw new ORPCError("NOT_FOUND", { message: "Source session not found" });
			}

			return createSessionOrThrow({
				configurationId: source.configurationId ?? undefined,
				sessionType: "coding",
				initialPrompt: input.initialPrompt,
				orgId: context.orgId,
				userId: context.user.id,
				continuedFromSessionId: input.mode === "continuation" ? input.sourceSessionId : undefined,
				rerunOfSessionId: input.mode === "rerun" ? input.sourceSessionId : undefined,
			});
		}),

	/**
	 * Create a new session from a configuration.
	 * Complex operation with sandbox provisioning.
	 */
	create: billingGatedProcedure
		.input(CreateSessionInputSchema)
		.output(CreateSessionResponseSchema)
		.handler(async ({ input, context }) => {
			return createSessionOrThrow({
				configurationId: input.configurationId,
				sessionType: input.sessionType,
				modelId: input.modelId,
				reasoningEffort: input.reasoningEffort,
				initialPrompt: input.initialPrompt,
				orgId: context.orgId,
				userId: context.user.id,
			});
		}),

	/**
	 * Delete a session.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ deleted: z.boolean() }))
		.handler(async ({ input, context }) => {
			await sessions.deleteSession(input.id, context.orgId);
			return { deleted: true };
		}),

	/**
	 * Rename a session.
	 */
	rename: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				title: z.string(),
			}),
		)
		.output(z.object({ session: SessionSchema }))
		.handler(async ({ input, context }) => {
			const session = await sessions.renameSession(input.id, context.orgId, input.title);
			if (!session) {
				throw new ORPCError("NOT_FOUND", { message: "Session not found" });
			}
			return { session };
		}),

	/**
	 * Pause a running session (snapshot + terminate).
	 */
	pause: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(
			z.object({
				paused: z.boolean(),
				snapshotId: z.string().nullable(),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				return await sessions.pauseSession({ sessionId: input.id, orgId: context.orgId });
			} catch (err) {
				if (err instanceof sessions.SessionNotFoundError)
					throw new ORPCError("NOT_FOUND", { message: err.message });
				if (err instanceof sessions.SessionInvalidStateError)
					throw new ORPCError("BAD_REQUEST", { message: err.message });
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: err instanceof Error ? err.message : "Failed to pause session",
				});
			}
		}),

	/**
	 * Create a snapshot of the session.
	 */
	snapshot: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ snapshot_id: z.string() }))
		.handler(async ({ input, context }) => {
			try {
				return await sessions.snapshotSession({ sessionId: input.id, orgId: context.orgId });
			} catch (err) {
				if (err instanceof sessions.SessionNotFoundError)
					throw new ORPCError("NOT_FOUND", { message: err.message });
				if (err instanceof sessions.SessionInvalidStateError)
					throw new ORPCError("BAD_REQUEST", { message: err.message });
				if (err instanceof sessions.SessionSnapshotQuotaError)
					throw new ORPCError("CONFLICT", { message: err.message });
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: err instanceof Error ? err.message : "Failed to create snapshot",
				});
			}
		}),

	/**
	 * Get session status (no auth required).
	 */
	status: publicProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(
			z.object({
				status: z.string(),
				isComplete: z.boolean(),
			}),
		)
		.handler(async ({ input }) => {
			const status = await sessions.getSessionStatus(input.id);
			if (!status) {
				throw new ORPCError("NOT_FOUND", { message: "Session not found" });
			}
			return status;
		}),

	/**
	 * Get billing-blocked sessions grouped by reason for inbox display.
	 */
	blockedSummary: orgProcedure
		.output(
			z.object({
				groups: z.array(
					z.object({
						reason: z.string(),
						count: z.number(),
						previewSessions: z.array(
							z.object({
								id: z.string(),
								title: z.string().nullable(),
								promptSnippet: z.string().nullable(),
								startedAt: z.string().nullable(),
								pausedAt: z.string().nullable(),
							}),
						),
					}),
				),
			}),
		)
		.handler(async ({ context }) => {
			return sessions.getBlockedSummary(context.orgId);
		}),

	/**
	 * Submit environment variables and secrets to a running session.
	 */
	submitEnv: orgProcedure
		.input(
			z.object({
				sessionId: z.string().uuid(),
				secrets: z.array(
					z.object({
						key: z.string(),
						value: z.string(),
						description: z.string().optional(),
						persist: z.boolean().optional(),
					}),
				),
				envVars: z.array(
					z.object({
						key: z.string(),
						value: z.string(),
					}),
				),
				saveToConfiguration: z.boolean(),
			}),
		)
		.output(
			z.object({
				submitted: z.boolean(),
				results: z
					.array(
						z.object({
							key: z.string(),
							persisted: z.boolean(),
							alreadyExisted: z.boolean(),
						}),
					)
					.optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				return await sessions.submitEnv({
					sessionId: input.sessionId,
					orgId: context.orgId,
					userId: context.user.id,
					secrets: input.secrets,
					envVars: input.envVars,
					saveToConfiguration: input.saveToConfiguration,
				});
			} catch (err) {
				if (err instanceof sessions.SessionNotFoundError)
					throw new ORPCError("NOT_FOUND", { message: err.message });
				if (err instanceof sessions.SessionInvalidStateError)
					throw new ORPCError("BAD_REQUEST", { message: err.message });
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: err instanceof Error ? err.message : "Failed to submit env",
				});
			}
		}),

	/**
	 * Archive a session (K6: soft-state archive).
	 */
	archive: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ archived: z.boolean() }))
		.handler(async ({ input, context }) => {
			await sessions.archiveSession({
				sessionId: input.id,
				organizationId: context.orgId,
				userId: context.user.id,
			});
			return { archived: true };
		}),

	/**
	 * Unarchive a session (K6).
	 */
	unarchive: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ unarchived: z.boolean() }))
		.handler(async ({ input, context }) => {
			await sessions.unarchiveSession({
				sessionId: input.id,
				organizationId: context.orgId,
			});
			return { unarchived: true };
		}),

	/**
	 * Soft-delete a session (K6).
	 */
	softDelete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ deleted: z.boolean() }))
		.handler(async ({ input, context }) => {
			await sessions.softDeleteSession({
				sessionId: input.id,
				organizationId: context.orgId,
				userId: context.user.id,
			});
			return { deleted: true };
		}),

	/**
	 * Share a session by granting access to another user (K2: ACL grant).
	 */
	share: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				userId: z.string(),
				role: z.enum(["viewer", "editor", "reviewer"]),
			}),
		)
		.output(z.object({ shared: z.boolean() }))
		.handler(async ({ input, context }) => {
			await sessions.grantSessionAccess({
				sessionId: input.id,
				organizationId: context.orgId,
				targetUserId: input.userId,
				role: input.role,
				grantedBy: context.user.id,
			});
			return { shared: true };
		}),

	/**
	 * Get session lifecycle events (K5).
	 */
	events: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(
			z.object({
				events: z.array(
					z.object({
						id: z.string(),
						eventType: z.string(),
						actorUserId: z.string().nullable(),
						createdAt: z.coerce.date(),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verify session belongs to org
			const session = await sessions.getSession(input.id, context.orgId);
			if (!session) {
				throw new ORPCError("NOT_FOUND", { message: "Session not found" });
			}
			const eventList = await sessions.getSessionEvents(input.id);
			return {
				events: eventList.map((e) => ({
					id: e.id,
					eventType: e.eventType,
					actorUserId: e.actorUserId,
					createdAt: e.createdAt,
				})),
			};
		}),

	/**
	 * Subscribe current user to session completion notifications via Slack DM.
	 */
	subscribeNotifications: orgProcedure
		.input(z.object({ sessionId: z.string().uuid() }))
		.output(z.object({ subscribed: z.boolean() }))
		.handler(async ({ input, context }) => {
			// Verify session belongs to org
			const session = await sessions.getSession(input.sessionId, context.orgId);
			if (!session) {
				throw new ORPCError("NOT_FOUND", { message: "Session not found" });
			}

			// Find active Slack installation for the org
			const installation = await integrations.getSlackInstallationForNotifications(context.orgId);
			if (!installation) {
				throw new ORPCError("BAD_REQUEST", {
					message: "No active Slack installation. Connect Slack in Settings > Integrations.",
				});
			}

			// Look up user's Slack user ID by email
			const userSlackId = await integrations.findSlackUserIdByEmail(
				installation.id,
				context.user.email,
			);
			if (!userSlackId) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Could not find a Slack account for ${context.user.email}. Make sure you use the same email in Slack and Proliferate.`,
				});
			}

			await notifications.subscribeToSessionNotifications({
				sessionId: input.sessionId,
				userId: context.user.id,
				slackInstallationId: installation.id,
				slackUserId: userSlackId,
				eventTypes: ["completed"],
			});
			return { subscribed: true };
		}),

	/**
	 * Unsubscribe current user from session notifications.
	 */
	unsubscribeNotifications: orgProcedure
		.input(z.object({ sessionId: z.string().uuid() }))
		.output(z.object({ unsubscribed: z.boolean() }))
		.handler(async ({ input, context }) => {
			const result = await notifications.unsubscribeFromSessionNotifications(
				input.sessionId,
				context.user.id,
			);
			return { unsubscribed: result };
		}),

	/**
	 * Check if current user is subscribed to session notifications.
	 */
	getNotificationSubscription: orgProcedure
		.input(z.object({ sessionId: z.string().uuid() }))
		.output(z.object({ subscribed: z.boolean() }))
		.handler(async ({ input, context }) => {
			const subscription = await notifications.getSessionNotificationSubscription(
				input.sessionId,
				context.user.id,
			);
			return { subscribed: !!subscription };
		}),
};
