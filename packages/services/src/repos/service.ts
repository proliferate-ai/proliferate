/**
 * Repos service.
 *
 * Business logic that orchestrates DB operations.
 */

import { randomUUID } from "crypto";
import { env } from "@proliferate/environment/server";
import { createRepoSnapshotBuildQueue } from "@proliferate/queue";
import type { Repo } from "@proliferate/shared";
import { getServicesLogger } from "../logger";
import type { CreateRepoInput, CreateRepoResult } from "../types/repos";
import * as reposDb from "./db";
import { toRepo, toRepoPartial, toRepos } from "./mapper";

let repoSnapshotBuildQueue: ReturnType<typeof createRepoSnapshotBuildQueue> | null = null;

function getRepoSnapshotBuildQueue() {
	if (!repoSnapshotBuildQueue) {
		repoSnapshotBuildQueue = createRepoSnapshotBuildQueue();
	}
	return repoSnapshotBuildQueue;
}

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

export async function getRepoSnapshotBuildInfo(
	repoId: string,
): Promise<reposDb.RepoSnapshotBuildInfoRow | null> {
	return reposDb.getSnapshotBuildInfo(repoId);
}

export async function markRepoSnapshotBuilding(repoId: string): Promise<boolean> {
	return reposDb.markRepoSnapshotBuilding(repoId, "modal");
}

export async function markRepoSnapshotReady(input: {
	repoId: string;
	snapshotId: string;
	commitSha: string | null;
}): Promise<void> {
	await reposDb.markRepoSnapshotReady({ ...input, provider: "modal" });
}

export async function markRepoSnapshotFailed(input: {
	repoId: string;
	error: string;
}): Promise<void> {
	await reposDb.markRepoSnapshotFailed({ ...input, provider: "modal" });
}

export async function requestRepoSnapshotBuild(
	repoId: string,
	options?: { force?: boolean },
): Promise<void> {
	// Repo snapshot builds only work with Modal provider.
	if (!env.MODAL_APP_NAME) return;

	try {
		const queue = getRepoSnapshotBuildQueue();
		// Use timestamp-based jobId so failed jobs don't block future rebuilds.
		const jobId = `repo:${repoId}:${Date.now()}`;
		await queue.add(`repo:${repoId}`, { repoId, force: options?.force ?? false }, { jobId });
		await reposDb.markRepoSnapshotBuilding(repoId, "modal");
	} catch (error) {
		getServicesLogger()
			.child({ module: "repos" })
			.warn({ err: error, repoId }, "Failed to enqueue repo snapshot build");
	}
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

	void requestRepoSnapshotBuild(newRepo.id);

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
