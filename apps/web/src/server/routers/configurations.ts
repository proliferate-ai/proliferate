/**
 * Configurations oRPC router.
 *
 * Handles configuration CRUD operations.
 */

import { logger } from "@/lib/logger";
import { ORPCError } from "@orpc/server";
import { configurations } from "@proliferate/services";
import {
	ConfigurationSchema,
	CreateConfigurationInputSchema,
	FinalizeSetupInputSchema,
	FinalizeSetupResponseSchema,
	UpdateConfigurationInputSchema,
} from "@proliferate/shared";
import { parseConfigurationServiceCommands } from "@proliferate/shared/sandbox";
import { z } from "zod";
import { orgProcedure } from "./middleware";

const log = logger.child({ handler: "configurations" });

export const configurationsRouter = {
	/**
	 * List configurations for the current organization.
	 */
	list: orgProcedure
		.input(z.object({ status: z.string().optional() }).optional())
		.output(z.object({ configurations: z.array(ConfigurationSchema) }))
		.handler(async ({ input, context }) => {
			const configurationsList = await configurations.listConfigurations(
				context.orgId,
				input?.status,
			);
			return { configurations: configurationsList };
		}),

	/**
	 * Create a new configuration.
	 */
	create: orgProcedure
		.input(CreateConfigurationInputSchema)
		.output(z.object({ configurationId: z.string().uuid(), repos: z.number() }))
		.handler(async ({ input, context }) => {
			// Support both new repoIds[] and legacy repos[] format
			const repoIds = input.repoIds || input.repos?.map((r) => r.repoId);

			if (!repoIds || repoIds.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "At least one repo is required",
				});
			}

			try {
				const result = await configurations.createConfiguration({
					organizationId: context.orgId,
					userId: context.user.id,
					repoIds,
					name: input.name,
				});

				return {
					configurationId: result.configurationId,
					repos: result.repoCount,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to create configuration";

				if (message === "One or more repos not found") {
					throw new ORPCError("NOT_FOUND", { message });
				}
				if (message === "Unauthorized access to repo") {
					throw new ORPCError("FORBIDDEN", { message });
				}

				log.error({ err: error }, "Failed to create configuration");
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message });
			}
		}),

	/**
	 * Update a configuration.
	 */
	update: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				...UpdateConfigurationInputSchema.shape,
			}),
		)
		.output(z.object({ configuration: ConfigurationSchema }))
		.handler(async ({ input, context }) => {
			const { id, name, notes } = input;

			// Verify the configuration exists and belongs to this org
			const belongsToOrg = await configurations.configurationBelongsToOrg(id, context.orgId);
			if (!belongsToOrg) {
				throw new ORPCError("NOT_FOUND", { message: "Configuration not found" });
			}

			try {
				const updated = await configurations.updateConfiguration(id, { name, notes });

				return {
					configuration: {
						id: updated.id!,
						snapshotId: updated.snapshotId ?? null,
						status: updated.status ?? null,
						name: updated.name ?? null,
						notes: updated.notes ?? null,
						createdAt: updated.createdAt?.toISOString() ?? null,
						createdBy: updated.createdBy ?? null,
						sandboxProvider: updated.sandboxProvider ?? null,
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to update configuration";

				if (message === "No fields to update") {
					throw new ORPCError("BAD_REQUEST", { message });
				}

				log.error({ err: error }, "Failed to update configuration");
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message });
			}
		}),

	/**
	 * Delete a configuration.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			// Verify the configuration belongs to this org
			const belongsToOrg = await configurations.configurationBelongsToOrg(input.id, context.orgId);
			if (!belongsToOrg) {
				throw new ORPCError("NOT_FOUND", { message: "Configuration not found" });
			}

			try {
				await configurations.deleteConfiguration(input.id);
				return { success: true };
			} catch (error) {
				log.error({ err: error }, "Failed to delete configuration");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to delete configuration",
				});
			}
		}),

	/**
	 * Get service commands for a configuration.
	 */
	getServiceCommands: orgProcedure
		.input(z.object({ configurationId: z.string().uuid() }))
		.output(
			z.object({
				commands: z.array(
					z.object({
						name: z.string(),
						command: z.string(),
						cwd: z.string().optional(),
						workspacePath: z.string().optional(),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			const belongsToOrg = await configurations.configurationBelongsToOrg(
				input.configurationId,
				context.orgId,
			);
			if (!belongsToOrg) {
				throw new ORPCError("NOT_FOUND", { message: "Configuration not found" });
			}

			const row = await configurations.getConfigurationServiceCommands(input.configurationId);
			const commands = parseConfigurationServiceCommands(row?.serviceCommands);
			return { commands };
		}),

	/**
	 * Get effective service commands for a configuration (resolved: configuration overrides > repo defaults).
	 */
	getEffectiveServiceCommands: orgProcedure
		.input(z.object({ configurationId: z.string().uuid() }))
		.output(
			z.object({
				source: z.enum(["configuration", "repo", "none"]),
				commands: z.array(
					z.object({
						name: z.string(),
						command: z.string(),
						cwd: z.string().optional(),
						workspacePath: z.string().optional(),
					}),
				),
				workspaces: z.array(z.string()),
			}),
		)
		.handler(async ({ input, context }) => {
			const belongsToOrg = await configurations.configurationBelongsToOrg(
				input.configurationId,
				context.orgId,
			);
			if (!belongsToOrg) {
				throw new ORPCError("NOT_FOUND", { message: "Configuration not found" });
			}

			return configurations.getEffectiveServiceCommands(input.configurationId);
		}),

	/**
	 * Get env file spec for a configuration.
	 */
	getEnvFiles: orgProcedure
		.input(z.object({ configurationId: z.string().uuid() }))
		.output(z.object({ envFiles: z.unknown().nullable() }))
		.handler(async ({ input, context }) => {
			const belongsToOrg = await configurations.configurationBelongsToOrg(
				input.configurationId,
				context.orgId,
			);
			if (!belongsToOrg) {
				throw new ORPCError("NOT_FOUND", { message: "Configuration not found" });
			}

			const envFiles = await configurations.getConfigurationEnvFiles(input.configurationId);
			return { envFiles: envFiles ?? null };
		}),

	/**
	 * Update service commands for a configuration.
	 */
	updateServiceCommands: orgProcedure
		.input(
			z.object({
				configurationId: z.string().uuid(),
				commands: z
					.array(
						z.object({
							name: z.string().min(1).max(100),
							command: z.string().min(1).max(1000),
							cwd: z.string().max(500).optional(),
							workspacePath: z.string().max(500).optional(),
						}),
					)
					.max(10),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			const belongsToOrg = await configurations.configurationBelongsToOrg(
				input.configurationId,
				context.orgId,
			);
			if (!belongsToOrg) {
				throw new ORPCError("NOT_FOUND", { message: "Configuration not found" });
			}

			await configurations.updateConfigurationServiceCommands({
				configurationId: input.configurationId,
				serviceCommands: input.commands,
				updatedBy: context.user.id,
			});
			return { success: true };
		}),

	/**
	 * Finalize setup session and create a configuration snapshot.
	 */
	finalizeSetup: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				...FinalizeSetupInputSchema.shape,
			}),
		)
		.output(FinalizeSetupResponseSchema)
		.handler(async ({ input, context }) => {
			const { finalizeSetupHandler } = await import("./configurations-finalize");
			return finalizeSetupHandler({
				repoId: input.id,
				sessionId: input.sessionId,
				secrets: input.secrets,
				name: input.name,
				notes: input.notes,
				updateSnapshotId: input.updateSnapshotId,
				keepRunning: input.keepRunning,
				userId: context.user.id,
			});
		}),

	/**
	 * Attach a repo to a configuration.
	 */
	attachRepo: orgProcedure
		.input(
			z.object({
				configurationId: z.string().uuid(),
				repoId: z.string().uuid(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			try {
				await configurations.attachRepo(input.configurationId, input.repoId, context.orgId);
				return { success: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to attach repo";
				if (message === "Configuration not found" || message === "Repo not found") {
					throw new ORPCError("NOT_FOUND", { message });
				}
				if (message === "Unauthorized access to repo") {
					throw new ORPCError("FORBIDDEN", { message });
				}
				log.error({ err: error }, "Failed to attach repo");
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message });
			}
		}),

	/**
	 * Detach a repo from a configuration.
	 */
	detachRepo: orgProcedure
		.input(
			z.object({
				configurationId: z.string().uuid(),
				repoId: z.string().uuid(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			try {
				await configurations.detachRepo(input.configurationId, input.repoId, context.orgId);
				return { success: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to detach repo";
				if (message === "Configuration not found") {
					throw new ORPCError("NOT_FOUND", { message });
				}
				log.error({ err: error }, "Failed to detach repo");
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message });
			}
		}),
};
