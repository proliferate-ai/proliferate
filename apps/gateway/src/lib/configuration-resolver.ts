/**
 * Configuration Resolver
 *
 * Handles configuration resolution for session creation:
 * - Direct configurationId lookup
 * - Managed configuration find/create (for Slack and similar universal clients)
 */

import { configurations } from "@proliferate/services";
import type { SandboxProvider } from "@proliferate/shared";
import { ApiError } from "../middleware";

export interface ResolvedConfiguration {
	id: string;
	snapshotId: string | null;
	repoIds: string[];
	isNew: boolean;
}

export interface ConfigurationResolutionOptions {
	organizationId: string;
	provider: SandboxProvider;

	/** Explicit configuration ID - just look it up */
	configurationId?: string;

	/** Managed configuration - find existing or create new with all org repos */
	managedConfiguration?: {
		repoIds?: string[]; // Optional: specific repo IDs, otherwise uses all org repos
	};

	/** User ID for device-scoped configurations */
	userId?: string;
}

/**
 * Resolve a configuration based on the provided options.
 * Exactly one of configurationId or managedConfiguration must be provided.
 */
export async function resolveConfiguration(
	options: ConfigurationResolutionOptions,
): Promise<ResolvedConfiguration> {
	const { configurationId, managedConfiguration } = options;

	// Validate exactly one option is provided
	const optionCount = [configurationId, managedConfiguration].filter(Boolean).length;
	if (optionCount === 0) {
		throw new Error("One of configurationId or managedConfiguration is required");
	}
	if (optionCount > 1) {
		throw new Error("Only one of configurationId or managedConfiguration can be provided");
	}

	if (configurationId) {
		return resolveDirect(configurationId);
	}

	if (managedConfiguration) {
		return resolveManaged(options.organizationId, managedConfiguration.repoIds);
	}

	// Should never reach here due to validation above
	throw new Error("Invalid configuration resolution options");
}

/**
 * Direct configuration lookup by ID
 */
async function resolveDirect(configurationId: string): Promise<ResolvedConfiguration> {
	const configuration = await configurations.findById(configurationId);

	if (!configuration) {
		throw new Error(`Configuration not found: ${configurationId}`);
	}

	// Get full configuration with repos
	const configurationRepos = await configurations.getConfigurationReposWithDetails(configurationId);
	const repoIds =
		configurationRepos?.map((cr) => cr.repo?.id).filter((id): id is string => Boolean(id)) || [];

	return {
		id: configuration.id,
		snapshotId: null, // Session creator resolves snapshot from active_snapshot_id
		repoIds,
		isNew: false,
	};
}

/**
 * Find or create managed configuration for an organization
 */
async function resolveManaged(
	organizationId: string,
	specificRepoIds?: string[],
): Promise<ResolvedConfiguration> {
	// Check for existing managed configuration (only if not creating with specific repos)
	if (!specificRepoIds) {
		const existing = await findManagedConfiguration(organizationId);
		if (existing) {
			return { ...existing, isNew: false };
		}
	}

	// Create new managed configuration
	const { configurationId, repoIds } = await createManagedConfigurationRecord(
		organizationId,
		specificRepoIds,
	);

	return {
		id: configurationId,
		snapshotId: null,
		repoIds,
		isNew: true,
	};
}

/**
 * Find existing managed configuration for an org
 */
async function findManagedConfiguration(
	organizationId: string,
): Promise<Omit<ResolvedConfiguration, "isNew"> | null> {
	const managedConfigurations = await configurations.findManagedConfigurations();

	// Filter to configurations that have repos in this org
	const orgConfigurations = managedConfigurations.filter((c) =>
		c.configurationRepos?.some((cr) => cr.repo?.organizationId === organizationId),
	);

	if (orgConfigurations.length === 0) {
		return null;
	}

	// Return the most recent one
	const best = orgConfigurations[0];
	const repoIds =
		best.configurationRepos?.map((cr) => cr.repo?.id).filter((id): id is string => Boolean(id)) ||
		[];

	return {
		id: best.id,
		snapshotId: null, // Session creator resolves snapshot from active_snapshot_id
		repoIds,
	};
}

/**
 * Create the managed configuration record in the database
 */
async function createManagedConfigurationRecord(
	organizationId: string,
	specificRepoIds?: string[],
): Promise<{ configurationId: string; repoIds: string[] }> {
	const repoRows = await configurations.getReposForManagedConfiguration(
		organizationId,
		specificRepoIds,
	);

	if (!repoRows || repoRows.length === 0) {
		throw new ApiError(422, "No repos found for organization");
	}

	// Create configuration record
	const configurationId = crypto.randomUUID();
	await configurations.createManagedConfiguration({ id: configurationId, organizationId });

	// Create configuration_repos entries
	const configurationReposEntries = repoRows.map((repo) => {
		const repoName = repo.githubRepoName?.split("/").pop() || repo.id;
		return {
			configurationId: configurationId,
			repoId: repo.id,
			workspacePath: repoRows.length === 1 ? "." : repoName,
		};
	});

	try {
		await configurations.createConfigurationRepos(configurationReposEntries);
	} catch (err) {
		// Clean up on failure
		await configurations.deleteConfiguration(configurationId);
		throw new Error(`Failed to link repos: ${err instanceof Error ? err.message : String(err)}`);
	}

	return {
		configurationId,
		repoIds: repoRows.map((r) => r.id),
	};
}
