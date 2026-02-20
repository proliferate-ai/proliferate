/**
 * Sessions oRPC router.
 *
 * Handles session CRUD and lifecycle operations.
 * Note: Complex operations (create, pause, snapshot) require sandbox provider
 * integration and remain as separate handlers imported here.
 */

import { ORPCError } from "@orpc/server";
import { integrations, notifications, sessions } from "@proliferate/services";
import {
	CreateSessionInputSchema,
	CreateSessionResponseSchema,
	SessionSchema,
} from "@proliferate/shared";
import { z } from "zod";
import { billingGatedProcedure, orgProcedure, publicProcedure } from "./middleware";

// Import complex handlers that need sandbox provider integration
import { createSessionHandler } from "./sessions-create";
import { pauseSessionHandler } from "./sessions-pause";
import { snapshotSessionHandler } from "./sessions-snapshot";
import { submitEnvHandler } from "./sessions-submit-env";

export const sessionsRouter = {
	/**
	 * List all sessions for the current organization.
	 */
	list: orgProcedure
		.input(
			z
				.object({
					repoId: z.string().uuid().optional(),
					status: z.string().optional(),
					limit: z.number().int().min(1).max(50).optional(),
					excludeSetup: z.boolean().optional(),
					excludeCli: z.boolean().optional(),
					excludeAutomation: z.boolean().optional(),
					createdBy: z.string().optional(),
				})
				.optional(),
		)
		.output(z.object({ sessions: z.array(SessionSchema) }))
		.handler(async ({ input, context }) => {
			const sessionsList = await sessions.listSessions(context.orgId, {
				repoId: input?.repoId,
				status: input?.status,
				limit: input?.limit,
				excludeSetup: input?.excludeSetup,
				excludeCli: input?.excludeCli,
				excludeAutomation: input?.excludeAutomation,
				createdBy: input?.createdBy,
			});
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
	 * Create a new session from a configuration.
	 * Complex operation with sandbox provisioning.
	 */
	create: billingGatedProcedure
		.input(CreateSessionInputSchema)
		.output(CreateSessionResponseSchema)
		.handler(async ({ input, context }) => {
			return createSessionHandler({
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
			return pauseSessionHandler({
				sessionId: input.id,
				orgId: context.orgId,
			});
		}),

	/**
	 * Create a snapshot of the session.
	 */
	snapshot: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ snapshot_id: z.string() }))
		.handler(async ({ input, context }) => {
			return snapshotSessionHandler({
				sessionId: input.id,
				orgId: context.orgId,
			});
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
			return submitEnvHandler({
				sessionId: input.sessionId,
				orgId: context.orgId,
				userId: context.user.id,
				secrets: input.secrets,
				envVars: input.envVars,
				saveToConfiguration: input.saveToConfiguration,
			});
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
					message:
						"Could not find your Slack account. Make sure you use the same email in Slack and Proliferate.",
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
