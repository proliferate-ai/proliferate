/**
 * Repos service.
 *
 * Business logic that orchestrates DB operations.
 */

import { randomUUID } from "crypto";
import type { Repo } from "@proliferate/shared";
import * as configurationsService from "../configurations/service";
import { getServicesLogger } from "../logger";
import type { CreateRepoInput, CreateRepoResult } from "../types/repos";
import * as reposDb from "./db";
import { toRepo, toRepoPartial, toRepos } from "./mapper";

// ============================================
// Service functions
// ============================================

/**
 * List all repos for an organization.
 */
export async function listRepos(orgId: string): Promise<Repo[]> {
	const rows = await reposDb.listByOrganization(orgId);
	return toRepos(rows);
}

/**
 * Get a single repo by ID.
 */
export async function getRepo(id: string, orgId: string): Promise<Repo | null> {
	const row = await reposDb.findById(id, orgId);
	if (!row) return null;
	return toRepo(row);
}

/**
 * Create or return existing repo.
 * Handles integration connection linking.
 */
export async function createRepo(input: CreateRepoInput): Promise<CreateRepoResult> {
	// Check if repo already exists
	const existingRepo = await reposDb.findByGithubRepoId(input.organizationId, input.githubRepoId);

	if (existingRepo) {
		// Link integration if provided
		if (input.integrationId) {
			await reposDb.createConnection(existingRepo.id, input.integrationId);

			// Un-orphan if it was orphaned
			if (existingRepo.isOrphaned) {
				await reposDb.updateOrphanedStatus(existingRepo.id, false);
			}
		}

		return {
			id: existingRepo.id,
			repo: toRepoPartial(existingRepo),
			existing: true,
		};
	}

	// Create new repo
	const repoId = randomUUID();
	const newRepo = await reposDb.create({
		id: repoId,
		organizationId: input.organizationId,
		githubRepoId: input.githubRepoId,
		githubRepoName: input.githubRepoName,
		githubUrl: input.githubUrl,
		defaultBranch: input.defaultBranch,
		addedBy: input.userId,
		isPrivate: input.isPrivate,
		source: input.source,
	});

	// Link integration if provided
	if (input.integrationId) {
		try {
			await reposDb.createConnection(repoId, input.integrationId);
		} catch (error) {
			getServicesLogger()
				.child({ module: "repos" })
				.error({ err: error, repoId }, "Failed to create repo_connection");
			// Don't fail - repo was created successfully
		}
	}

	return {
		id: newRepo.id,
		repo: toRepoPartial(newRepo),
		existing: false,
	};
}

/**
 * Delete a repo.
 */
export async function deleteRepo(id: string, orgId: string): Promise<boolean> {
	await reposDb.deleteById(id, orgId);
	return true;
}

/**
 * Check if a repo exists and belongs to the organization.
 */
export async function repoExists(id: string, orgId: string): Promise<boolean> {
	return reposDb.exists(id, orgId);
}

/**
 * Get service commands for a repo (raw jsonb).
 */
export async function getServiceCommands(
	repoId: string,
	orgId: string,
): Promise<{ serviceCommands: unknown } | null> {
	return reposDb.getServiceCommands(repoId, orgId);
}

/**
 * Update service commands for a repo.
 */
export async function updateServiceCommands(input: {
	repoId: string;
	orgId: string;
	serviceCommands: unknown;
	updatedBy: string;
}): Promise<void> {
	await reposDb.updateServiceCommands(input);
}

/**
 * Create a repo and auto-create an associated single-repo configuration.
 *
 * The configuration creation is tightly coupled to snapshot building —
 * createConfiguration() always enqueues a snapshot build job.
 */
export async function createRepoWithConfiguration(
	input: CreateRepoInput,
): Promise<CreateRepoResult> {
	const result = await createRepo(input);

	if (!result.existing) {
		try {
			await configurationsService.createConfiguration({
				organizationId: input.organizationId,
				userId: input.userId,
				repoIds: [result.id],
			});
		} catch (error) {
			getServicesLogger()
				.child({ module: "repos" })
				.warn({ err: error, repoId: result.id }, "Failed to auto-create configuration for repo");
			// Don't fail — the repo was created successfully
		}
	}

	return result;
}
