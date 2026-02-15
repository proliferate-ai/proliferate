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
	UpdateConfigurationInputSchema,
} from "@proliferate/shared";
import { parseServiceCommands } from "@proliferate/shared/sandbox";
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
			const configurationsList = await configurations.listConfigurations(context.orgId);
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
					message: "repoIds[] is required",
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
				if (message === "repoIds[] is required") {
					throw new ORPCError("BAD_REQUEST", { message });
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
			const { id, name, description } = input;

			// Verify the configuration exists and belongs to this org
			const belongsToOrg = await configurations.configurationBelongsToOrg(id, context.orgId);
			if (!belongsToOrg) {
				throw new ORPCError("NOT_FOUND", { message: "Configuration not found" });
			}

			try {
				const updated = await configurations.updateConfiguration(id, { name, description });

				return {
					configuration: {
						id: updated.id!,
						name: updated.name ?? null,
						description: updated.description ?? null,
						createdAt: updated.createdAt?.toISOString() ?? null,
						sandboxProvider: null,
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
			const commands = parseServiceCommands(row?.serviceCommands);
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
			});
			return { success: true };
		}),
};
