/**
 * Prebuilds service.
 *
 * Business logic that orchestrates DB operations.
 */

import { randomUUID } from "crypto";
import { env } from "@proliferate/environment/server";
import type { Prebuild } from "@proliferate/shared";
import * as prebuildsDb from "./db";
import { toPrebuild, toPrebuildPartial, toPrebuilds } from "./mapper";

// ============================================
// Types
// ============================================

export interface CreatePrebuildInput {
	organizationId: string;
	userId: string;
	repoIds: string[];
	name?: string;
}

export interface CreatePrebuildResult {
	prebuildId: string;
	repoCount: number;
}

export interface UpdatePrebuildInput {
	name?: string;
	notes?: string;
}

// ============================================
// Service functions
// ============================================

/**
 * List prebuilds for an organization.
 * Filters to only include prebuilds with repos in the given org.
 */
export async function listPrebuilds(orgId: string, status?: string): Promise<Prebuild[]> {
	const rows = await prebuildsDb.listAll(status);

	// Filter to only prebuilds that have repos in this org
	const filteredRows = rows.filter((p) =>
		p.prebuildRepos?.some((pr) => pr.repo?.organizationId === orgId),
	);

	return toPrebuilds(filteredRows);
}

/**
 * Get a single prebuild by ID.
 */
export async function getPrebuild(id: string): Promise<Prebuild | null> {
	const row = await prebuildsDb.findByIdFull(id);
	if (!row) return null;
	return toPrebuild(row);
}

/**
 * Create a new prebuild with repos.
 *
 * @throws Error if repos not found or unauthorized
 */
export async function createPrebuild(input: CreatePrebuildInput): Promise<CreatePrebuildResult> {
	const { organizationId, userId, repoIds, name } = input;

	if (!repoIds || repoIds.length === 0) {
		throw new Error("repoIds[] is required");
	}

	// Verify repos exist and belong to organization
	const repos = await prebuildsDb.getReposByIds(repoIds);

	if (!repos || repos.length !== repoIds.length) {
		throw new Error("One or more repos not found");
	}

	for (const repo of repos) {
		if (repo.organizationId !== organizationId) {
			throw new Error("Unauthorized access to repo");
		}
	}

	// Create prebuild record
	const prebuildId = randomUUID();
	await prebuildsDb.create({
		id: prebuildId,
		name,
		createdBy: userId,
		sandboxProvider: env.DEFAULT_SANDBOX_PROVIDER,
	});

	// Create prebuild_repos entries with derived workspace paths
	const prebuildRepos = repoIds.map((repoId) => {
		const repo = repos.find((r) => r.id === repoId);
		const repoName = repo?.githubRepoName?.split("/").pop() || repoId;
		return {
			prebuildId,
			repoId,
			workspacePath: repoIds.length === 1 ? "." : repoName,
		};
	});

	try {
		await prebuildsDb.createPrebuildRepos(prebuildRepos);
	} catch (error) {
		// Rollback: delete the prebuild if junction creation fails
		await prebuildsDb.deleteById(prebuildId);
		throw new Error("Failed to link repos to prebuild");
	}

	return {
		prebuildId,
		repoCount: repoIds.length,
	};
}

/**
 * Update a prebuild.
 *
 * @throws Error if nothing to update
 */
export async function updatePrebuild(
	id: string,
	input: UpdatePrebuildInput,
): Promise<Partial<Prebuild>> {
	if (input.name === undefined && input.notes === undefined) {
		throw new Error("No fields to update");
	}

	const updated = await prebuildsDb.update(id, input);
	return toPrebuildPartial(updated);
}

/**
 * Delete a prebuild.
 */
export async function deletePrebuild(id: string): Promise<boolean> {
	await prebuildsDb.deleteById(id);
	return true;
}

/**
 * Check if a prebuild exists.
 */
export async function prebuildExists(id: string): Promise<boolean> {
	const prebuild = await prebuildsDb.findById(id);
	return !!prebuild;
}

/**
 * Check if a prebuild belongs to an organization (via its linked repos).
 */
export async function prebuildBelongsToOrg(prebuildId: string, orgId: string): Promise<boolean> {
	const prebuild = await prebuildsDb.findById(prebuildId);
	if (!prebuild) return false;
	return prebuild.prebuildRepos.some((pr) => pr.repo?.organizationId === orgId);
}
