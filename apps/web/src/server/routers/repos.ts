/**
 * Repos oRPC router.
 */

import { type GitHubIntegration, listGitHubRepos } from "@/lib/github";
import { ORPCError } from "@orpc/server";
import { integrations, repos } from "@proliferate/services";
import {
	CreateRepoInputSchema,
	GitHubRepoSchema,
	RepoSchema,
	SearchRepoSchema,
} from "@proliferate/shared";
import { z } from "zod";
import { orgProcedure } from "./middleware";

// Provider value for Nango GitHub integrations
const NANGO_GITHUB_PROVIDER = "github-app";

export const reposRouter = {
	/**
	 * List all repos for the current organization.
	 */
	list: orgProcedure
		.input(z.object({}).optional())
		.output(z.object({ repos: z.array(RepoSchema) }))
		.handler(async ({ context }) => {
			const reposList = await repos.listRepos(context.orgId);
			return { repos: reposList };
		}),

	/**
	 * Get a single repo by ID.
	 */
	get: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ repo: RepoSchema }))
		.handler(async ({ input, context }) => {
			const repo = await repos.getRepo(input.id, context.orgId);
			if (!repo) {
				throw new ORPCError("NOT_FOUND", { message: "Repo not found" });
			}
			return { repo };
		}),

	/**
	 * Add a repo to the organization.
	 */
	create: orgProcedure
		.input(CreateRepoInputSchema)
		.output(
			z.object({
				id: z.string().uuid(),
				repo: RepoSchema.partial(),
				existing: z.boolean(),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await repos.createRepoWithConfiguration({
				organizationId: context.orgId,
				userId: context.user.id,
				githubRepoId: input.githubRepoId,
				githubUrl: input.githubUrl,
				githubRepoName: input.githubRepoName,
				defaultBranch: input.defaultBranch,
				integrationId: input.integrationId,
				isPrivate: input.isPrivate,
				source: input.source,
			});
			return result;
		}),

	/**
	 * Delete a repo.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ deleted: z.boolean() }))
		.handler(async ({ input, context }) => {
			await repos.deleteRepo(input.id, context.orgId);
			return { deleted: true };
		}),

	/**
	 * List available GitHub repositories for an integration.
	 */
	available: orgProcedure
		.input(z.object({ integrationId: z.string().optional() }))
		.output(
			z.object({
				repositories: z.array(GitHubRepoSchema),
				integrationId: z.string(),
			}),
		)
		.handler(async ({ input, context }) => {
			const orgId = context.orgId;

			let integration: GitHubIntegration | null = null;

			if (input.integrationId) {
				integration = await integrations.findActiveIntegrationForRepos(input.integrationId, orgId);
			} else {
				// Try GitHub App first
				integration = await integrations.findFirstActiveGitHubAppForRepos(orgId);

				if (!integration) {
					// Fall back to Nango GitHub connection
					integration = await integrations.findFirstActiveNangoGitHubForRepos(
						orgId,
						NANGO_GITHUB_PROVIDER,
					);
				}
			}

			if (!integration || (!integration.githubInstallationId && !integration.connectionId)) {
				throw new ORPCError("BAD_REQUEST", { message: "GitHub not connected" });
			}

			const result = await listGitHubRepos(integration);
			return {
				repositories: result.repositories || [],
				integrationId: integration.id,
			};
		}),

	/**
	 * Search public GitHub repositories.
	 */
	search: orgProcedure
		.input(z.object({ q: z.string().optional() }))
		.output(z.object({ repositories: z.array(SearchRepoSchema) }))
		.handler(async ({ input }) => {
			try {
				const repositories = await repos.searchPublicGitHubRepos(input.q);
				return { repositories };
			} catch {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to search GitHub" });
			}
		}),

	/**
	 * Get service commands for a repo.
	 */
	getServiceCommands: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(
			z.object({
				commands: z.array(
					z.object({
						name: z.string(),
						command: z.string(),
						cwd: z.string().optional(),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			const exists = await repos.repoExists(input.id, context.orgId);
			if (!exists) {
				throw new ORPCError("NOT_FOUND", { message: "Repo not found" });
			}

			const row = await repos.getServiceCommands(input.id, context.orgId);
			const { parseServiceCommands } = await import("@proliferate/shared/sandbox");
			const commands = parseServiceCommands(row?.serviceCommands);
			return { commands };
		}),

	/**
	 * Update service commands for a repo.
	 */
	updateServiceCommands: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				commands: z
					.array(
						z.object({
							name: z.string().min(1).max(100),
							command: z.string().min(1).max(1000),
							cwd: z.string().max(500).optional(),
						}),
					)
					.max(10),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			const exists = await repos.repoExists(input.id, context.orgId);
			if (!exists) {
				throw new ORPCError("NOT_FOUND", { message: "Repo not found" });
			}

			await repos.updateServiceCommands({
				repoId: input.id,
				orgId: context.orgId,
				serviceCommands: input.commands,
				updatedBy: context.user.id,
			});
			return { success: true };
		}),
};
