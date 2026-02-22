/**
 * Configuration Resolver
 *
 * Handles configuration resolution for session creation:
 * - Direct configurationId lookup
 * - Managed configuration find/create (for Slack and similar universal clients)
 * - CLI device-scoped configuration find/create
 */

import { cli, configurations } from "@proliferate/services";
import type { SandboxProvider } from "@proliferate/shared";
import { ApiError } from "../middleware";

export interface ResolvedConfiguration {
	id: string;
	snapshotId: string | null;
	status: string | null;
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

	/** CLI device-scoped configuration - find/create for this device */
	cliConfiguration?: {
		localPathHash: string;
		displayName?: string;
	};

	/** User ID for device-scoped configurations */
	userId?: string;
}

/**
 * Resolve a configuration based on the provided options.
 * Exactly one of configurationId, managedConfiguration, or cliConfiguration must be provided.
 */
export async function resolveConfiguration(
	options: ConfigurationResolutionOptions,
): Promise<ResolvedConfiguration> {
	const { configurationId, managedConfiguration, cliConfiguration } = options;

	// Validate exactly one option is provided
	const optionCount = [configurationId, managedConfiguration, cliConfiguration].filter(
		Boolean,
	).length;
	if (optionCount === 0) {
		throw new Error(
			"One of configurationId, managedConfiguration, or cliConfiguration is required",
		);
	}
	if (optionCount > 1) {
		throw new Error(
			"Only one of configurationId, managedConfiguration, or cliConfiguration can be provided",
		);
	}

	if (configurationId) {
		return resolveDirect(configurationId);
	}

	if (managedConfiguration) {
		return resolveManaged(options.organizationId, managedConfiguration.repoIds);
	}

	if (cliConfiguration) {
		if (!options.userId) {
			throw new Error("userId is required for CLI configurations");
		}
		return resolveCli(
			options.organizationId,
			options.userId,
			cliConfiguration.localPathHash,
			cliConfiguration.displayName,
			options.provider,
		);
	}

	// Should never reach here due to validation above
	throw new Error("Invalid configuration resolution options");
}

/**
 * Direct configuration lookup by ID
 */
async function resolveDirect(configurationId: string): Promise<ResolvedConfiguration> {
	const configuration = await configurations.findByIdForSession(configurationId);

	if (!configuration) {
		throw new Error(`Configuration not found: ${configurationId}`);
	}

	const configurationRepos = await configurations.getConfigurationReposWithDetails(configurationId);
	const repoIds =
		configurationRepos?.map((pr) => pr.repo?.id).filter((id): id is string => Boolean(id)) || [];

	return {
		id: configuration.id,
		snapshotId: configuration.snapshotId ?? null,
		status: configuration.status ?? null,
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
		status: "building",
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
	const orgConfigurations = managedConfigurations.filter((p) =>
		p.configurationRepos?.some((pr) => pr.repo?.organizationId === organizationId),
	);

	if (orgConfigurations.length === 0) {
		return null;
	}

	// Return the most recent one (prefer one with snapshot, but return any)
	const best = orgConfigurations.find((p) => p.snapshotId) || orgConfigurations[0];
	const repoIds =
		best.configurationRepos?.map((pr) => pr.repo?.id).filter((id): id is string => Boolean(id)) ||
		[];

	return {
		id: best.id,
		snapshotId: best.snapshotId,
		status: best.status,
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
	await configurations.createManagedConfiguration({ id: configurationId });

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

	// Tightly coupled: managed configuration creation triggers snapshot build
	void configurations.requestConfigurationSnapshotBuild(configurationId);

	return {
		configurationId,
		repoIds: repoRows.map((r) => r.id),
	};
}

/**
 * Find or create CLI device-scoped configuration
 */
async function resolveCli(
	organizationId: string,
	userId: string,
	localPathHash: string,
	displayName: string | undefined,
	provider: SandboxProvider,
): Promise<ResolvedConfiguration> {
	// Check for existing configuration
	const existingConfiguration = await cli.getCliConfiguration(userId, localPathHash);

	if (existingConfiguration) {
		// Get linked repos via configuration_repos
		const configurationRepos = await configurations.getConfigurationReposWithDetails(
			existingConfiguration.id,
		);
		const repoIds =
			configurationRepos?.map((pr) => pr.repo?.id).filter((id): id is string => Boolean(id)) || [];

		return {
			id: existingConfiguration.id,
			snapshotId: existingConfiguration.snapshot_id,
			status: null, // CLI configs go pending → ready (no "default" state)
			repoIds,
			isNew: false,
		};
	}

	// Create new configuration using CLI service
	const { id: configurationId } = await cli.createCliConfigurationPending({
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

	// Link repo to configuration
	await cli.upsertConfigurationRepo({
		configurationId,
		repoId,
		workspacePath: ".",
	});

	return {
		id: configurationId,
		snapshotId: null,
		status: "pending",
		repoIds: [repoId],
		isNew: true,
	};
}
