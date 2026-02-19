/**
 * Configurations DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import {
	type InferSelectModel,
	and,
	configurationRepos,
	configurations,
	desc,
	eq,
	getDb,
	inArray,
	isNull,
	repos,
	type sessions,
} from "../db/client";
import { getServicesLogger } from "../logger";
import type {
	CreateConfigurationFullInput,
	CreateConfigurationInput,
	CreateConfigurationRepoInput,
	CreateManagedConfigurationInput,
	UpdateConfigurationInput,
} from "../types/configurations";

// ============================================
// Types
// ============================================

/** Configuration row type from Drizzle schema */
export type ConfigurationRow = InferSelectModel<typeof configurations>;

/** Configuration repo row type from Drizzle schema */
export type ConfigurationRepoRow = InferSelectModel<typeof configurationRepos>;

/** Repo row type from Drizzle schema */
export type RepoRow = InferSelectModel<typeof repos>;

/** Session row type (for relations) */
export type SessionRow = InferSelectModel<typeof sessions>;

/** Configuration with repos and sessions relations */
export interface ConfigurationWithRelationsRow extends ConfigurationRow {
	configurationRepos: Array<{
		workspacePath: string;
		repo: {
			id: string;
			githubRepoName: string;
			githubUrl: string;
			organizationId: string;
		} | null;
	}>;
	sessions: Array<{
		id: string;
		sessionType: string | null;
		status: string | null;
	}>;
}

/** Configuration with minimal repo data for auth check */
export interface ConfigurationWithOrgRow {
	id: string;
	configurationRepos: Array<{
		repo: {
			organizationId: string;
		} | null;
	}>;
}

/** Repo basic info */
export interface RepoBasicRow {
	id: string;
	organizationId: string;
	githubRepoName: string;
}

/** Configuration data for session creation */
export interface ConfigurationForSessionRow {
	id: string;
	snapshotId: string | null;
	sandboxProvider: string | null;
	status: string | null;
}

/** Configuration repo with full repo details for session creation */
export interface ConfigurationRepoDetailRow {
	workspacePath: string;
	repo: {
		id: string;
		githubUrl: string;
		githubRepoName: string;
		defaultBranch: string | null;
		organizationId: string;
		repoSnapshotId: string | null;
		repoSnapshotStatus: string | null;
		repoSnapshotProvider: string | null;
		serviceCommands: unknown;
	} | null;
}

/** Configuration repos with nested configuration data for snapshots */
export interface ConfigurationRepoWithConfigurationRow {
	configurationId: string;
	workspacePath: string;
	configuration: {
		id: string;
		snapshotId: string | null;
		status: string | null;
		name: string;
		notes: string | null;
		createdAt: Date | null;
		createdBy: string | null;
		sessions: Array<{ id: string; sessionType: string | null }>;
	} | null;
}

/** Repo info for snapshots */
export interface SnapshotRepoRow {
	id: string;
	githubRepoName: string;
}

/** Managed configuration with repos for lookup */
export interface ManagedConfigurationRow {
	id: string;
	snapshotId: string | null;
	status: string | null;
	configurationRepos: Array<{
		repo: {
			id: string;
			organizationId: string;
			githubRepoName: string;
		} | null;
	}>;
}

/** Repo with github_repo_name for managed configuration creation */
export interface RepoWithNameRow {
	id: string;
	githubRepoName: string;
}

/** Configuration row for repo listing (simpler than full ConfigurationRow) */
export interface RepoConfigurationRow {
	id: string;
	name: string;
	notes: string | null;
	status: string | null;
	createdAt: Date | null;
	snapshotId: string | null;
}

/** Configuration snapshot build info (for worker) */
export interface ConfigurationSnapshotBuildInfoRow {
	id: string;
	snapshotId: string | null;
	status: string | null;
	sandboxProvider: string | null;
	error: string | null;
	configurationRepos: Array<{
		workspacePath: string;
		repo: {
			id: string;
			githubUrl: string;
			githubRepoName: string;
			defaultBranch: string | null;
			organizationId: string;
			isPrivate: boolean | null;
		} | null;
	}>;
}

// ============================================
// Queries
// ============================================

/**
 * List configurations with repos and setup sessions.
 * Optionally filter by status.
 */
export async function listAll(status?: string): Promise<ConfigurationWithRelationsRow[]> {
	const db = getDb();

	const conditions = [];
	if (status) {
		conditions.push(eq(configurations.status, status));
	}

	const results = await db.query.configurations.findMany({
		where: conditions.length > 0 ? and(...conditions) : undefined,
		orderBy: [desc(configurations.createdAt)],
		with: {
			configurationRepos: {
				with: {
					repo: {
						columns: {
							id: true,
							githubRepoName: true,
							githubUrl: true,
							organizationId: true,
						},
					},
				},
			},
			sessions: {
				columns: {
					id: true,
					sessionType: true,
					status: true,
				},
			},
		},
	});

	return results as ConfigurationWithRelationsRow[];
}

/**
 * Get a configuration by ID with minimal repos (for auth check).
 */
export async function findById(id: string): Promise<ConfigurationWithOrgRow | null> {
	const db = getDb();
	const result = await db.query.configurations.findFirst({
		where: eq(configurations.id, id),
		columns: {
			id: true,
		},
		with: {
			configurationRepos: {
				with: {
					repo: {
						columns: {
							organizationId: true,
						},
					},
				},
			},
		},
	});

	return result ?? null;
}

/**
 * Get a configuration by ID with full relations.
 */
export async function findByIdFull(id: string): Promise<ConfigurationWithRelationsRow | null> {
	const db = getDb();
	const result = await db.query.configurations.findFirst({
		where: eq(configurations.id, id),
		with: {
			configurationRepos: {
				with: {
					repo: {
						columns: {
							id: true,
							githubRepoName: true,
							githubUrl: true,
							organizationId: true,
						},
					},
				},
			},
			sessions: {
				columns: {
					id: true,
					sessionType: true,
					status: true,
				},
			},
		},
	});

	return (result as ConfigurationWithRelationsRow) ?? null;
}

/**
 * Get multiple repos by IDs.
 */
export async function getReposByIds(repoIds: string[]): Promise<RepoBasicRow[]> {
	const db = getDb();
	const results = await db.query.repos.findMany({
		where: inArray(repos.id, repoIds),
		columns: {
			id: true,
			organizationId: true,
			githubRepoName: true,
		},
	});

	return results;
}

/**
 * Create a new configuration record.
 */
export async function create(input: CreateConfigurationInput): Promise<void> {
	const db = getDb();
	await db.insert(configurations).values({
		id: input.id,
		snapshotId: null,
		status: "building",
		name: input.name || "Untitled",
		createdBy: input.createdBy,
		sandboxProvider: input.sandboxProvider,
	});
}

/**
 * Create configuration_repos junction entries.
 */
export async function createConfigurationRepos(
	entries: CreateConfigurationRepoInput[],
): Promise<void> {
	const db = getDb();
	const rows = entries.map((e) => ({
		configurationId: e.configurationId,
		repoId: e.repoId,
		workspacePath: e.workspacePath,
	}));

	await db.insert(configurationRepos).values(rows);
}

/**
 * Update a configuration.
 */
export async function update(
	id: string,
	input: UpdateConfigurationInput,
): Promise<ConfigurationRow> {
	const db = getDb();
	const updates: Partial<typeof configurations.$inferInsert> = {};

	if (input.name !== undefined) updates.name = input.name || "Untitled";
	if (input.notes !== undefined) updates.notes = input.notes;
	if (input.snapshotId !== undefined) updates.snapshotId = input.snapshotId;
	if (input.status !== undefined) updates.status = input.status;

	const [result] = await db
		.update(configurations)
		.set(updates)
		.where(eq(configurations.id, id))
		.returning();

	return result;
}

/**
 * Delete a configuration by ID.
 */
export async function deleteById(id: string): Promise<void> {
	const db = getDb();
	await db.delete(configurations).where(eq(configurations.id, id));
}

/**
 * Get configuration by ID for session creation.
 */
export async function findByIdForSession(id: string): Promise<ConfigurationForSessionRow | null> {
	const db = getDb();
	const result = await db.query.configurations.findFirst({
		where: eq(configurations.id, id),
		columns: {
			id: true,
			snapshotId: true,
			sandboxProvider: true,
			status: true,
		},
	});

	return result ?? null;
}

/**
 * Get configuration repos with full repo details for session creation.
 */
export async function getConfigurationReposWithDetails(
	configurationId: string,
): Promise<ConfigurationRepoDetailRow[]> {
	const db = getDb();
	const results = await db.query.configurationRepos.findMany({
		where: eq(configurationRepos.configurationId, configurationId),
		with: {
			repo: {
				columns: {
					id: true,
					githubUrl: true,
					githubRepoName: true,
					defaultBranch: true,
					organizationId: true,
					repoSnapshotId: true,
					repoSnapshotStatus: true,
					repoSnapshotProvider: true,
					serviceCommands: true,
				},
			},
		},
	});

	return results.map((r) => ({
		workspacePath: r.workspacePath,
		repo: r.repo,
	}));
}

/**
 * Get configuration-level service commands.
 */
export async function getConfigurationServiceCommands(
	configurationId: string,
): Promise<{ serviceCommands: unknown } | null> {
	const db = getDb();
	const result = await db.query.configurations.findFirst({
		where: eq(configurations.id, configurationId),
		columns: { serviceCommands: true },
	});
	return result ?? null;
}

/**
 * Update configuration-level service commands.
 */
export async function updateConfigurationServiceCommands(input: {
	configurationId: string;
	serviceCommands: unknown;
	updatedBy: string;
}): Promise<void> {
	const db = getDb();
	await db
		.update(configurations)
		.set({
			serviceCommands: input.serviceCommands,
			serviceCommandsUpdatedAt: new Date(),
			serviceCommandsUpdatedBy: input.updatedBy,
		})
		.where(eq(configurations.id, input.configurationId));
}

/**
 * Update configuration-level env file spec.
 */
export async function updateConfigurationEnvFiles(input: {
	configurationId: string;
	envFiles: unknown;
	updatedBy: string;
}): Promise<void> {
	const db = getDb();
	await db
		.update(configurations)
		.set({
			envFiles: input.envFiles,
			envFilesUpdatedAt: new Date(),
			envFilesUpdatedBy: input.updatedBy,
		})
		.where(eq(configurations.id, input.configurationId));
}

/**
 * Get configuration env file spec.
 */
export async function getConfigurationEnvFiles(configurationId: string): Promise<unknown | null> {
	const db = getDb();
	const result = await db.query.configurations.findFirst({
		where: eq(configurations.id, configurationId),
		columns: { envFiles: true },
	});
	return result?.envFiles ?? null;
}

/**
 * Update configuration snapshot_id only if currently null.
 * Returns true if updated, false if already had a snapshot.
 */
export async function updateSnapshotIdIfNull(
	configurationId: string,
	snapshotId: string,
): Promise<boolean> {
	const db = getDb();
	const result = await db
		.update(configurations)
		.set({ snapshotId })
		.where(and(eq(configurations.id, configurationId), isNull(configurations.snapshotId)))
		.returning({ id: configurations.id });

	return result.length > 0;
}

/**
 * Create a new configuration with full details (for finalize).
 */
export async function createFull(input: CreateConfigurationFullInput): Promise<void> {
	const db = getDb();
	await db.insert(configurations).values({
		id: input.id,
		snapshotId: input.snapshotId,
		status: input.status,
		name: input.name || "Untitled",
		notes: input.notes || null,
		createdBy: input.createdBy,
	});
}

/**
 * Check if a configuration contains a specific repo.
 */
export async function configurationContainsRepo(
	configurationId: string,
	repoId: string,
): Promise<boolean> {
	const db = getDb();
	const result = await db.query.configurationRepos.findFirst({
		where: and(
			eq(configurationRepos.configurationId, configurationId),
			eq(configurationRepos.repoId, repoId),
		),
		columns: {
			repoId: true,
		},
	});

	return !!result;
}

/**
 * Create a single configuration_repo junction entry.
 */
export async function createSingleConfigurationRepo(
	configurationId: string,
	repoId: string,
	workspacePath: string,
): Promise<void> {
	const db = getDb();
	try {
		await db.insert(configurationRepos).values({
			configurationId,
			repoId,
			workspacePath,
		});
	} catch (error) {
		getServicesLogger()
			.child({ module: "configurations-db" })
			.error({ err: error, configurationId, repoId }, "Failed to create configuration_repos entry");
	}
}

/**
 * Delete a configuration_repo junction entry.
 */
export async function deleteConfigurationRepo(
	configurationId: string,
	repoId: string,
): Promise<void> {
	const db = getDb();
	await db
		.delete(configurationRepos)
		.where(
			and(
				eq(configurationRepos.configurationId, configurationId),
				eq(configurationRepos.repoId, repoId),
			),
		);
}

// ============================================
// Repo-specific configuration queries
// ============================================

/**
 * List configurations for a specific repo.
 */
export async function listByRepoId(repoId: string): Promise<RepoConfigurationRow[]> {
	const db = getDb();

	// Get configurations through the junction table
	const results = await db.query.configurationRepos.findMany({
		where: eq(configurationRepos.repoId, repoId),
		with: {
			configuration: {
				columns: {
					id: true,
					name: true,
					notes: true,
					status: true,
					createdAt: true,
					snapshotId: true,
				},
			},
		},
	});

	return results
		.map((r) => r.configuration)
		.filter((p): p is NonNullable<typeof p> => p !== null)
		.sort((a, b) => {
			const aTime = a.createdAt?.getTime() ?? 0;
			const bTime = b.createdAt?.getTime() ?? 0;
			return bTime - aTime;
		});
}

// ============================================
// Snapshot queries (usable configurations with repos)
// ============================================

/**
 * Get configuration_repos with configuration data for a specific repo.
 */
export async function getConfigurationReposWithConfigurations(
	repoId: string,
): Promise<ConfigurationRepoWithConfigurationRow[]> {
	const db = getDb();
	const results = await db.query.configurationRepos.findMany({
		where: eq(configurationRepos.repoId, repoId),
		with: {
			configuration: {
				columns: {
					id: true,
					snapshotId: true,
					status: true,
					name: true,
					notes: true,
					createdAt: true,
					createdBy: true,
				},
				with: {
					sessions: {
						columns: {
							id: true,
							sessionType: true,
						},
					},
				},
			},
		},
	});

	return results.map((r) => ({
		configurationId: r.configurationId,
		workspacePath: r.workspacePath,
		configuration: r.configuration
			? {
					...r.configuration,
					sessions: r.configuration.sessions ?? [],
				}
			: null,
	}));
}

/**
 * Get repos linked to a configuration.
 */
export async function getReposForConfiguration(
	configurationId: string,
): Promise<SnapshotRepoRow[]> {
	const db = getDb();
	const results = await db.query.configurationRepos.findMany({
		where: eq(configurationRepos.configurationId, configurationId),
		with: {
			repo: {
				columns: {
					id: true,
					githubRepoName: true,
				},
			},
		},
	});

	return results.map((r) => r.repo).filter((r): r is NonNullable<typeof r> => r !== null);
}

// ============================================
// Managed Configuration queries
// ============================================

/**
 * Find managed configurations with their repos.
 */
export async function findManagedConfigurations(): Promise<ManagedConfigurationRow[]> {
	const db = getDb();
	const results = await db.query.configurations.findMany({
		where: eq(configurations.type, "managed"),
		orderBy: [desc(configurations.createdAt)],
		columns: {
			id: true,
			snapshotId: true,
			status: true,
		},
		with: {
			configurationRepos: {
				with: {
					repo: {
						columns: {
							id: true,
							organizationId: true,
							githubRepoName: true,
						},
					},
				},
			},
		},
	});

	return results;
}

/**
 * Create a managed configuration record.
 */
export async function createManagedConfiguration(
	input: CreateManagedConfigurationInput,
): Promise<void> {
	const db = getDb();
	await db.insert(configurations).values({
		id: input.id,
		type: "managed",
		status: "building",
		snapshotId: null,
		name: "Managed Configuration",
	});
}

/**
 * Delete a configuration by ID (for cleanup on failure).
 */
export async function deleteConfiguration(id: string): Promise<void> {
	const db = getDb();
	await db.delete(configurations).where(eq(configurations.id, id));
}

/**
 * Get repos for an organization by IDs (or all if no IDs provided).
 */
export async function getReposForManagedConfiguration(
	orgId: string,
	repoIds?: string[],
): Promise<RepoWithNameRow[]> {
	const db = getDb();

	const conditions = [eq(repos.organizationId, orgId)];
	if (repoIds && repoIds.length > 0) {
		conditions.push(inArray(repos.id, repoIds));
	}

	const results = await db.query.repos.findMany({
		where: and(...conditions),
		columns: {
			id: true,
			githubRepoName: true,
		},
	});

	return results;
}

// ============================================
// Configuration Snapshot Build Operations
// ============================================

/**
 * Get configuration info needed to build a snapshot.
 * Includes linked repos with details needed for cloning.
 */
export async function getConfigurationSnapshotBuildInfo(
	configurationId: string,
): Promise<ConfigurationSnapshotBuildInfoRow | null> {
	const db = getDb();
	const result = await db.query.configurations.findFirst({
		where: eq(configurations.id, configurationId),
		columns: {
			id: true,
			snapshotId: true,
			status: true,
			sandboxProvider: true,
			error: true,
		},
		with: {
			configurationRepos: {
				with: {
					repo: {
						columns: {
							id: true,
							githubUrl: true,
							githubRepoName: true,
							defaultBranch: true,
							organizationId: true,
							isPrivate: true,
						},
					},
				},
			},
		},
	});
	return (result as ConfigurationSnapshotBuildInfoRow | undefined) ?? null;
}

/**
 * Mark a configuration as building (snapshot build in progress).
 */
export async function markConfigurationSnapshotBuilding(configurationId: string): Promise<void> {
	const db = getDb();
	await db
		.update(configurations)
		.set({ status: "building", error: null })
		.where(eq(configurations.id, configurationId));
}

/**
 * Mark a configuration snapshot as default (auto-built with repos cloned).
 */
export async function markConfigurationSnapshotDefault(
	configurationId: string,
	snapshotId: string,
): Promise<void> {
	const db = getDb();
	await db
		.update(configurations)
		.set({ snapshotId, status: "default", error: null })
		.where(
			and(
				eq(configurations.id, configurationId),
				eq(configurations.status, "building"),
				isNull(configurations.snapshotId),
			),
		);
}

/**
 * Mark a configuration snapshot build as failed.
 */
export async function markConfigurationSnapshotFailed(
	configurationId: string,
	error: string,
): Promise<void> {
	const db = getDb();
	await db
		.update(configurations)
		.set({ status: "failed", error })
		.where(eq(configurations.id, configurationId));
}
