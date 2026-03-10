/**
 * Configurations oRPC router.
 *
 * Handles configuration CRUD operations.
 */

import { logger } from "@/lib/infra/logger";
import { ORPCError } from "@orpc/server";
import { configurations, repos } from "@proliferate/services";
import {
	ConfigurationSchema,
	CreateConfigurationInputSchema,
	UpdateConfigurationInputSchema,
} from "@proliferate/shared/contracts/configurations";
import {
	FinalizeSetupInputSchema,
	FinalizeSetupResponseSchema,
} from "@proliferate/shared/contracts/repos";
import { z } from "zod";
import { orgProcedure } from "./middleware";

const log = logger.child({ handler: "configurations" });

function throwMappedConfigurationError(error: unknown, internalMessage: string): never {
	if (error instanceof ORPCError) {
		throw error;
	}
	if (error instanceof configurations.ConfigurationNotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: error.message });
	}
	if (error instanceof configurations.ConfigurationForbiddenError) {
		throw new ORPCError("FORBIDDEN", { message: error.message });
	}
	if (error instanceof configurations.ConfigurationValidationError) {
		throw new ORPCError("BAD_REQUEST", { message: error.message });
	}
	if (error instanceof configurations.RepoNotInConfigurationError) {
		throw new ORPCError("NOT_FOUND", { message: error.message });
	}
	if (error instanceof configurations.ConfigurationRepoLinkError) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
	}
	if (error instanceof configurations.SecretStorageError) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
	}

	log.error({ err: error }, internalMessage);
	throw new ORPCError("INTERNAL_SERVER_ERROR", { message: internalMessage });
}

export const configurationsRouter = {
	/**
	 * List configurations for the current organization.
	 */
	list: orgProcedure
		.input(z.object({ status: z.string().optional() }).optional())
		.output(z.object({ configurations: z.array(ConfigurationSchema) }))
		.handler(async ({ input, context }) => {
			try {
				const configurationsList = await configurations.listConfigurations(
					context.orgId,
					input?.status,
				);
				return { configurations: configurationsList };
			} catch (error) {
				throwMappedConfigurationError(error, "Failed to list configurations");
			}
		}),

	/**
	 * Get a single configuration by ID.
	 */
	get: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ configuration: ConfigurationSchema }))
		.handler(async ({ input, context }) => {
			try {
				const configuration = await configurations.getConfigurationForOrg(input.id, context.orgId);
				return { configuration };
			} catch (error) {
				throwMappedConfigurationError(error, "Failed to fetch configuration");
			}
		}),

	/**
	 * Create a new configuration.
	 */
	create: orgProcedure
		.input(CreateConfigurationInputSchema)
		.output(z.object({ configurationId: z.string().uuid(), repos: z.number() }))
		.handler(async ({ input, context }) => {
			try {
				const result = await configurations.createConfigurationForOrg({
					organizationId: context.orgId,
					userId: context.user.id,
					repoIds: input.repoIds,
					legacyRepos: input.repos,
					name: input.name,
				});

				return {
					configurationId: result.configurationId,
					repos: result.repoCount,
				};
			} catch (error) {
				throwMappedConfigurationError(error, "Failed to create configuration");
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
			const { id, name, notes, routingDescription } = input;
			try {
				const configuration = await configurations.updateConfigurationForOrg(id, context.orgId, {
					name,
					notes,
					routingDescription,
				});
				return { configuration };
			} catch (error) {
				throwMappedConfigurationError(error, "Failed to update configuration");
			}
		}),

	/**
	 * Delete a configuration.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			try {
				await configurations.deleteConfigurationForOrg(input.id, context.orgId);
				return { success: true };
			} catch (error) {
				throwMappedConfigurationError(error, "Failed to delete configuration");
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
			try {
				const commands = await configurations.getConfigurationServiceCommandsForOrg(
					input.configurationId,
					context.orgId,
				);
				return { commands };
			} catch (error) {
				throwMappedConfigurationError(error, "Failed to fetch configuration service commands");
			}
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
			try {
				await configurations.getConfigurationForOrg(input.configurationId, context.orgId);
				return configurations.getEffectiveServiceCommands(input.configurationId);
			} catch (error) {
				throwMappedConfigurationError(error, "Failed to fetch effective service commands");
			}
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
			try {
				await configurations.updateConfigurationServiceCommandsForOrg({
					configurationId: input.configurationId,
					orgId: context.orgId,
					updatedBy: context.user.id,
					serviceCommands: input.commands,
				});
				return { success: true };
			} catch (error) {
				throwMappedConfigurationError(error, "Failed to update configuration service commands");
			}
		}),

	/**
	 * Finalize setup session and create a configuration snapshot.
	 */
	finalizeSetup: orgProcedure
		.input(
			z.object({
				id: z.string().uuid().optional(),
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
				orgId: context.orgId,
			});
		}),

	/**
	 * List ready configurations (snapshots) for a repo.
	 */
	listSnapshots: orgProcedure
		.input(z.object({ repoId: z.string().uuid() }))
		.output(
			z.object({
				snapshots: z.array(
					z.object({
						id: z.string(),
						snapshotId: z.string(),
						createdAt: z.date().nullable(),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				// Verify the repo belongs to this org before listing snapshots
				const repoExists = await repos.repoExists(input.repoId, context.orgId);
				if (!repoExists) {
					throw new ORPCError("NOT_FOUND", { message: "Repository not found" });
				}
				const snapshots = await configurations.listReadyConfigurationsForRepo(input.repoId);
				return { snapshots };
			} catch (error) {
				throwMappedConfigurationError(error, "Failed to list snapshots");
			}
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
				await configurations.attachRepoForOrg(input.configurationId, input.repoId, context.orgId);
				return { success: true };
			} catch (error) {
				throwMappedConfigurationError(error, "Failed to attach repo");
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
				await configurations.detachRepoForOrg(input.configurationId, input.repoId, context.orgId);
				return { success: true };
			} catch (error) {
				throwMappedConfigurationError(error, "Failed to detach repo");
			}
		}),
};
