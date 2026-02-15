/**
 * Sessions oRPC router.
 *
 * Handles session CRUD and lifecycle operations.
 * Note: Complex operations (create, pause, snapshot) require sandbox provider
 * integration and remain as separate handlers imported here.
 */

import { ORPCError } from "@orpc/server";
import { sessions } from "@proliferate/services";
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
				})
				.optional(),
		)
		.output(z.object({ sessions: z.array(SessionSchema) }))
		.handler(async ({ input, context }) => {
			const sessionsList = await sessions.listSessions(context.orgId, {
				repoId: input?.repoId,
				status: input?.status,
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
	 * Create a new session from a prebuild.
	 * Complex operation with sandbox provisioning.
	 */
	create: billingGatedProcedure
		.input(CreateSessionInputSchema)
		.output(CreateSessionResponseSchema)
		.handler(async ({ input, context }) => {
			return createSessionHandler({
				prebuildId: input.prebuildId,
				sessionType: input.sessionType,
				modelId: input.modelId,
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
				saveToPrebuild: z.boolean(),
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
				saveToPrebuild: input.saveToPrebuild,
			});
		}),
};
