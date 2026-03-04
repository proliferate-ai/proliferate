/**
 * Configuration Resolver
 *
 * Resolves a configuration for session creation:
 * - Direct configurationId lookup
 * - Managed configuration find/create (for Slack and similar universal clients)
 */

import { configurations } from "@proliferate/services";
import { ApiError } from "../../../../middleware/errors";

export interface ResolvedConfiguration {
	id: string;
	snapshotId: string | null;
	status: string | null;
	repoIds: string[];
	isNew: boolean;
}

export interface ConfigurationResolutionOptions {
	organizationId: string;

	/** Explicit configuration ID - just look it up */
	configurationId?: string;

	/** Managed configuration - find existing or create new with all org repos */
	managedConfiguration?: {
		repoIds?: string[];
	};
}

/**
 * Resolve a configuration based on the provided options.
 * Exactly one of configurationId or managedConfiguration must be provided.
 */
export async function resolveConfiguration(
	options: ConfigurationResolutionOptions,
): Promise<ResolvedConfiguration> {
	const { configurationId, managedConfiguration } = options;

	if (configurationId) {
		return resolveDirect(configurationId);
	}

	if (managedConfiguration) {
		return resolveManaged(options.organizationId, managedConfiguration.repoIds);
	}

	throw new Error("One of configurationId or managedConfiguration is required");
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
	if (!specificRepoIds) {
		const existing = await findManagedConfiguration(organizationId);
		if (existing) {
			return { ...existing, isNew: false };
		}
	}

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

async function findManagedConfiguration(
	organizationId: string,
): Promise<Omit<ResolvedConfiguration, "isNew"> | null> {
	const managedConfigurations = await configurations.findManagedConfigurations();

	const orgConfigurations = managedConfigurations.filter((p) =>
		p.configurationRepos?.some((pr) => pr.repo?.organizationId === organizationId),
	);

	if (orgConfigurations.length === 0) {
		return null;
	}

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

	const configurationId = crypto.randomUUID();
	await configurations.createManagedConfiguration({ id: configurationId });

	const configurationReposEntries = repoRows.map((repo) => {
		const repoName = repo.githubRepoName?.split("/").pop() || repo.id;
		return {
			configurationId,
			repoId: repo.id,
			workspacePath: repoRows.length === 1 ? "." : repoName,
		};
	});

	try {
		await configurations.createConfigurationRepos(configurationReposEntries);
	} catch (err) {
		await configurations.deleteConfiguration(configurationId);
		throw new Error(`Failed to link repos: ${err instanceof Error ? err.message : String(err)}`);
	}

	void configurations.requestConfigurationSnapshotBuild(configurationId);

	return {
		configurationId,
		repoIds: repoRows.map((r) => r.id),
	};
}
