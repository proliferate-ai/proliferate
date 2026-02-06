/**
 * Prebuild Resolver
 *
 * Handles prebuild resolution for session creation:
 * - Direct prebuildId lookup
 * - Managed prebuild find/create (for Slack and similar universal clients)
 * - CLI device-scoped prebuild find/create
 */

import { cli, prebuilds } from "@proliferate/services";
import type { SandboxProvider } from "@proliferate/shared";

export interface ResolvedPrebuild {
	id: string;
	snapshotId: string | null;
	repoIds: string[];
	isNew: boolean;
}

export interface PrebuildResolutionOptions {
	organizationId: string;
	provider: SandboxProvider;

	/** Explicit prebuild ID - just look it up */
	prebuildId?: string;

	/** Managed prebuild - find existing or create new with all org repos */
	managedPrebuild?: {
		repoIds?: string[]; // Optional: specific repo IDs, otherwise uses all org repos
	};

	/** CLI device-scoped prebuild - find/create for this device */
	cliPrebuild?: {
		localPathHash: string;
		displayName?: string;
	};

	/** User ID for device-scoped prebuilds */
	userId?: string;
}

/**
 * Resolve a prebuild based on the provided options.
 * Exactly one of prebuildId, managedPrebuild, or cliPrebuild must be provided.
 */
export async function resolvePrebuild(
	options: PrebuildResolutionOptions,
): Promise<ResolvedPrebuild> {
	const { prebuildId, managedPrebuild, cliPrebuild } = options;

	// Validate exactly one option is provided
	const optionCount = [prebuildId, managedPrebuild, cliPrebuild].filter(Boolean).length;
	if (optionCount === 0) {
		throw new Error("One of prebuildId, managedPrebuild, or cliPrebuild is required");
	}
	if (optionCount > 1) {
		throw new Error("Only one of prebuildId, managedPrebuild, or cliPrebuild can be provided");
	}

	if (prebuildId) {
		return resolveDirect(prebuildId);
	}

	if (managedPrebuild) {
		return resolveManaged(options.organizationId, managedPrebuild.repoIds);
	}

	if (cliPrebuild) {
		if (!options.userId) {
			throw new Error("userId is required for CLI prebuilds");
		}
		return resolveCli(
			options.organizationId,
			options.userId,
			cliPrebuild.localPathHash,
			cliPrebuild.displayName,
			options.provider,
		);
	}

	// Should never reach here due to validation above
	throw new Error("Invalid prebuild resolution options");
}

/**
 * Direct prebuild lookup by ID
 */
async function resolveDirect(prebuildId: string): Promise<ResolvedPrebuild> {
	const prebuild = await prebuilds.findById(prebuildId);

	if (!prebuild) {
		throw new Error(`Prebuild not found: ${prebuildId}`);
	}

	// Get full prebuild with repos
	const prebuildRepos = await prebuilds.getPrebuildReposWithDetails(prebuildId);
	const repoIds =
		prebuildRepos?.map((pr) => pr.repo?.id).filter((id): id is string => Boolean(id)) || [];

	// Get snapshot ID from full prebuild
	const fullPrebuild = await prebuilds.findByIdFull(prebuildId);

	return {
		id: prebuild.id,
		snapshotId: fullPrebuild?.snapshotId ?? null,
		repoIds,
		isNew: false,
	};
}

/**
 * Find or create managed prebuild for an organization
 */
async function resolveManaged(
	organizationId: string,
	specificRepoIds?: string[],
): Promise<ResolvedPrebuild> {
	// Check for existing managed prebuild (only if not creating with specific repos)
	if (!specificRepoIds) {
		const existing = await findManagedPrebuild(organizationId);
		if (existing) {
			return { ...existing, isNew: false };
		}
	}

	// Create new managed prebuild
	const { prebuildId, repoIds } = await createManagedPrebuildRecord(
		organizationId,
		specificRepoIds,
	);

	return {
		id: prebuildId,
		snapshotId: null,
		repoIds,
		isNew: true,
	};
}

/**
 * Find existing managed prebuild for an org
 */
async function findManagedPrebuild(
	organizationId: string,
): Promise<Omit<ResolvedPrebuild, "isNew"> | null> {
	const managedPrebuilds = await prebuilds.findManagedPrebuilds();

	// Filter to prebuilds that have repos in this org
	const orgPrebuilds = managedPrebuilds.filter((p) =>
		p.prebuildRepos?.some((pr) => pr.repo?.organizationId === organizationId),
	);

	if (orgPrebuilds.length === 0) {
		return null;
	}

	// Return the most recent one (prefer one with snapshot, but return any)
	const best = orgPrebuilds.find((p) => p.snapshotId) || orgPrebuilds[0];
	const repoIds =
		best.prebuildRepos?.map((pr) => pr.repo?.id).filter((id): id is string => Boolean(id)) || [];

	return {
		id: best.id,
		snapshotId: best.snapshotId,
		repoIds,
	};
}

/**
 * Create the managed prebuild record in the database
 */
async function createManagedPrebuildRecord(
	organizationId: string,
	specificRepoIds?: string[],
): Promise<{ prebuildId: string; repoIds: string[] }> {
	const repoRows = await prebuilds.getReposForManagedPrebuild(organizationId, specificRepoIds);

	if (!repoRows || repoRows.length === 0) {
		throw new Error("No repos found for organization");
	}

	// Create prebuild record
	const prebuildId = crypto.randomUUID();
	await prebuilds.createManagedPrebuild({ id: prebuildId });

	// Create prebuild_repos entries
	const prebuildReposEntries = repoRows.map((repo) => {
		const repoName = repo.githubRepoName?.split("/").pop() || repo.id;
		return {
			prebuildId: prebuildId,
			repoId: repo.id,
			workspacePath: repoRows.length === 1 ? "." : repoName,
		};
	});

	try {
		await prebuilds.createPrebuildRepos(prebuildReposEntries);
	} catch (err) {
		// Clean up on failure
		await prebuilds.deletePrebuild(prebuildId);
		throw new Error(`Failed to link repos: ${err instanceof Error ? err.message : String(err)}`);
	}

	return {
		prebuildId,
		repoIds: repoRows.map((r) => r.id),
	};
}

/**
 * Find or create CLI device-scoped prebuild
 */
async function resolveCli(
	organizationId: string,
	userId: string,
	localPathHash: string,
	displayName: string | undefined,
	provider: SandboxProvider,
): Promise<ResolvedPrebuild> {
	// Check for existing prebuild
	const existingPrebuild = await cli.getCliPrebuild(userId, localPathHash);

	if (existingPrebuild) {
		// Get linked repos via prebuild_repos
		const prebuildRepos = await prebuilds.getPrebuildReposWithDetails(existingPrebuild.id);
		const repoIds =
			prebuildRepos?.map((pr) => pr.repo?.id).filter((id): id is string => Boolean(id)) || [];

		return {
			id: existingPrebuild.id,
			snapshotId: existingPrebuild.snapshot_id,
			repoIds,
			isNew: false,
		};
	}

	// Create new prebuild using CLI service
	const { id: prebuildId } = await cli.createCliPrebuildPending({
		userId,
		localPathHash,
		sandboxProvider: provider.type,
	});

	// Find or create local repo
	let repoId: string;
	const existingRepo = await cli.findLocalRepo(organizationId, localPathHash);

	if (existingRepo) {
		repoId = existingRepo.id;
	} else {
		const newRepo = await cli.createLocalRepo({
			organizationId,
			addedBy: userId,
			localPathHash,
			displayName: displayName || "Local Directory",
		});
		repoId = newRepo.id;
	}

	// Link repo to prebuild
	try {
		await cli.upsertPrebuildRepo({
			prebuildId,
			repoId,
			workspacePath: ".",
		});
	} catch (err) {
		console.error("Failed to link repo to prebuild:", err);
		// Non-fatal
	}

	return {
		id: prebuildId,
		snapshotId: null,
		repoIds: [repoId],
		isNew: true,
	};
}
