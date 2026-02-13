/**
 * Prebuilds DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import {
	type InferSelectModel,
	and,
	desc,
	eq,
	getDb,
	inArray,
	isNull,
	prebuildRepos,
	prebuilds,
	repos,
	type sessions,
} from "../db/client";
import { getServicesLogger } from "../logger";
import type {
	CreateManagedPrebuildInput,
	CreatePrebuildFullInput,
	CreatePrebuildInput,
	CreatePrebuildRepoInput,
	UpdatePrebuildInput,
} from "../types/prebuilds";

// ============================================
// Types
// ============================================

/** Prebuild row type from Drizzle schema */
export type PrebuildRow = InferSelectModel<typeof prebuilds>;

/** Prebuild repo row type from Drizzle schema */
export type PrebuildRepoRow = InferSelectModel<typeof prebuildRepos>;

/** Repo row type from Drizzle schema */
export type RepoRow = InferSelectModel<typeof repos>;

/** Session row type (for relations) */
export type SessionRow = InferSelectModel<typeof sessions>;

/** Prebuild with repos and sessions relations */
export interface PrebuildWithRelationsRow extends PrebuildRow {
	prebuildRepos: Array<{
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

/** Prebuild with minimal repo data for auth check */
export interface PrebuildWithOrgRow {
	id: string;
	prebuildRepos: Array<{
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

/** Prebuild data for session creation */
export interface PrebuildForSessionRow {
	id: string;
	snapshotId: string | null;
	sandboxProvider: string | null;
	status: string | null;
}

/** Prebuild repo with full repo details for session creation */
export interface PrebuildRepoDetailRow {
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

/** Prebuild repos with nested prebuild data for snapshots */
export interface PrebuildRepoWithPrebuildRow {
	prebuildId: string;
	workspacePath: string;
	prebuild: {
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

/** Managed prebuild with repos for lookup */
export interface ManagedPrebuildRow {
	id: string;
	snapshotId: string | null;
	prebuildRepos: Array<{
		repo: {
			id: string;
			organizationId: string;
			githubRepoName: string;
		} | null;
	}>;
}

/** Repo with github_repo_name for managed prebuild creation */
export interface RepoWithNameRow {
	id: string;
	githubRepoName: string;
}

/** Prebuild row for repo listing (simpler than full PrebuildRow) */
export interface RepoPrebuildRow {
	id: string;
	name: string;
	notes: string | null;
	status: string | null;
	createdAt: Date | null;
	snapshotId: string | null;
}

// ============================================
// Queries
// ============================================

/**
 * List prebuilds with repos and setup sessions.
 * Optionally filter by status.
 */
export async function listAll(status?: string): Promise<PrebuildWithRelationsRow[]> {
	const db = getDb();

	const conditions = [];
	if (status) {
		conditions.push(eq(prebuilds.status, status));
	}

	const results = await db.query.prebuilds.findMany({
		where: conditions.length > 0 ? and(...conditions) : undefined,
		orderBy: [desc(prebuilds.createdAt)],
		with: {
			prebuildRepos: {
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

	return results as PrebuildWithRelationsRow[];
}

/**
 * Get a prebuild by ID with minimal repos (for auth check).
 */
export async function findById(id: string): Promise<PrebuildWithOrgRow | null> {
	const db = getDb();
	const result = await db.query.prebuilds.findFirst({
		where: eq(prebuilds.id, id),
		columns: {
			id: true,
		},
		with: {
			prebuildRepos: {
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
 * Get a prebuild by ID with full relations.
 */
export async function findByIdFull(id: string): Promise<PrebuildWithRelationsRow | null> {
	const db = getDb();
	const result = await db.query.prebuilds.findFirst({
		where: eq(prebuilds.id, id),
		with: {
			prebuildRepos: {
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

	return (result as PrebuildWithRelationsRow) ?? null;
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
 * Create a new prebuild record.
 */
export async function create(input: CreatePrebuildInput): Promise<void> {
	const db = getDb();
	await db.insert(prebuilds).values({
		id: input.id,
		snapshotId: null,
		status: "building",
		name: input.name || "Untitled",
		createdBy: input.createdBy,
		sandboxProvider: input.sandboxProvider,
	});
}

/**
 * Create prebuild_repos junction entries.
 */
export async function createPrebuildRepos(entries: CreatePrebuildRepoInput[]): Promise<void> {
	const db = getDb();
	const rows = entries.map((e) => ({
		prebuildId: e.prebuildId,
		repoId: e.repoId,
		workspacePath: e.workspacePath,
	}));

	await db.insert(prebuildRepos).values(rows);
}

/**
 * Update a prebuild.
 */
export async function update(id: string, input: UpdatePrebuildInput): Promise<PrebuildRow> {
	const db = getDb();
	const updates: Partial<typeof prebuilds.$inferInsert> = {};

	if (input.name !== undefined) updates.name = input.name || "Untitled";
	if (input.notes !== undefined) updates.notes = input.notes;
	if (input.snapshotId !== undefined) updates.snapshotId = input.snapshotId;
	if (input.status !== undefined) updates.status = input.status;

	const [result] = await db.update(prebuilds).set(updates).where(eq(prebuilds.id, id)).returning();

	return result;
}

/**
 * Delete a prebuild by ID.
 */
export async function deleteById(id: string): Promise<void> {
	const db = getDb();
	await db.delete(prebuilds).where(eq(prebuilds.id, id));
}

/**
 * Get prebuild by ID for session creation.
 */
export async function findByIdForSession(id: string): Promise<PrebuildForSessionRow | null> {
	const db = getDb();
	const result = await db.query.prebuilds.findFirst({
		where: eq(prebuilds.id, id),
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
 * Get prebuild repos with full repo details for session creation.
 */
export async function getPrebuildReposWithDetails(
	prebuildId: string,
): Promise<PrebuildRepoDetailRow[]> {
	const db = getDb();
	const results = await db.query.prebuildRepos.findMany({
		where: eq(prebuildRepos.prebuildId, prebuildId),
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
 * Get prebuild-level service commands.
 */
export async function getPrebuildServiceCommands(
	prebuildId: string,
): Promise<{ serviceCommands: unknown } | null> {
	const db = getDb();
	const result = await db.query.prebuilds.findFirst({
		where: eq(prebuilds.id, prebuildId),
		columns: { serviceCommands: true },
	});
	return result ?? null;
}

/**
 * Update prebuild-level service commands.
 */
export async function updatePrebuildServiceCommands(input: {
	prebuildId: string;
	serviceCommands: unknown;
	updatedBy: string;
}): Promise<void> {
	const db = getDb();
	await db
		.update(prebuilds)
		.set({
			serviceCommands: input.serviceCommands,
			serviceCommandsUpdatedAt: new Date(),
			serviceCommandsUpdatedBy: input.updatedBy,
		})
		.where(eq(prebuilds.id, input.prebuildId));
}

/**
 * Update prebuild-level env file spec.
 */
export async function updatePrebuildEnvFiles(input: {
	prebuildId: string;
	envFiles: unknown;
	updatedBy: string;
}): Promise<void> {
	const db = getDb();
	await db
		.update(prebuilds)
		.set({
			envFiles: input.envFiles,
			envFilesUpdatedAt: new Date(),
			envFilesUpdatedBy: input.updatedBy,
		})
		.where(eq(prebuilds.id, input.prebuildId));
}

/**
 * Get prebuild env file spec.
 */
export async function getPrebuildEnvFiles(prebuildId: string): Promise<unknown | null> {
	const db = getDb();
	const result = await db.query.prebuilds.findFirst({
		where: eq(prebuilds.id, prebuildId),
		columns: { envFiles: true },
	});
	return result?.envFiles ?? null;
}

/**
 * Get prebuild connector configs.
 */
export async function getPrebuildConnectors(
	prebuildId: string,
): Promise<{ connectors: unknown } | null> {
	const db = getDb();
	const result = await db.query.prebuilds.findFirst({
		where: eq(prebuilds.id, prebuildId),
		columns: { connectors: true },
	});
	return result ?? null;
}

/**
 * Update prebuild connector configs.
 */
export async function updatePrebuildConnectors(input: {
	prebuildId: string;
	connectors: unknown;
	updatedBy: string;
}): Promise<void> {
	const db = getDb();
	await db
		.update(prebuilds)
		.set({
			connectors: input.connectors,
			connectorsUpdatedAt: new Date(),
			connectorsUpdatedBy: input.updatedBy,
		})
		.where(eq(prebuilds.id, input.prebuildId));
}

/**
 * Update prebuild snapshot_id only if currently null.
 * Returns true if updated, false if already had a snapshot.
 */
export async function updateSnapshotIdIfNull(
	prebuildId: string,
	snapshotId: string,
): Promise<boolean> {
	const db = getDb();
	const result = await db
		.update(prebuilds)
		.set({ snapshotId })
		.where(and(eq(prebuilds.id, prebuildId), isNull(prebuilds.snapshotId)))
		.returning({ id: prebuilds.id });

	return result.length > 0;
}

/**
 * Create a new prebuild with full details (for finalize).
 */
export async function createFull(input: CreatePrebuildFullInput): Promise<void> {
	const db = getDb();
	await db.insert(prebuilds).values({
		id: input.id,
		snapshotId: input.snapshotId,
		status: input.status,
		name: input.name || "Untitled",
		notes: input.notes || null,
		createdBy: input.createdBy,
	});
}

/**
 * Check if a prebuild contains a specific repo.
 */
export async function prebuildContainsRepo(prebuildId: string, repoId: string): Promise<boolean> {
	const db = getDb();
	const result = await db.query.prebuildRepos.findFirst({
		where: and(eq(prebuildRepos.prebuildId, prebuildId), eq(prebuildRepos.repoId, repoId)),
		columns: {
			repoId: true,
		},
	});

	return !!result;
}

/**
 * Create a single prebuild_repo junction entry.
 */
export async function createSinglePrebuildRepo(
	prebuildId: string,
	repoId: string,
	workspacePath: string,
): Promise<void> {
	const db = getDb();
	try {
		await db.insert(prebuildRepos).values({
			prebuildId,
			repoId,
			workspacePath,
		});
	} catch (error) {
		getServicesLogger()
			.child({ module: "prebuilds-db" })
			.error({ err: error, prebuildId, repoId }, "Failed to create prebuild_repos entry");
	}
}

// ============================================
// Repo-specific prebuild queries
// ============================================

/**
 * List prebuilds for a specific repo.
 */
export async function listByRepoId(repoId: string): Promise<RepoPrebuildRow[]> {
	const db = getDb();

	// Get prebuilds through the junction table
	const results = await db.query.prebuildRepos.findMany({
		where: eq(prebuildRepos.repoId, repoId),
		with: {
			prebuild: {
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
		.map((r) => r.prebuild)
		.filter((p): p is NonNullable<typeof p> => p !== null)
		.sort((a, b) => {
			const aTime = a.createdAt?.getTime() ?? 0;
			const bTime = b.createdAt?.getTime() ?? 0;
			return bTime - aTime;
		});
}

// ============================================
// Snapshot queries (usable prebuilds with repos)
// ============================================

/**
 * Get prebuild_repos with prebuild data for a specific repo.
 */
export async function getPrebuildReposWithPrebuilds(
	repoId: string,
): Promise<PrebuildRepoWithPrebuildRow[]> {
	const db = getDb();
	const results = await db.query.prebuildRepos.findMany({
		where: eq(prebuildRepos.repoId, repoId),
		with: {
			prebuild: {
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
		prebuildId: r.prebuildId,
		workspacePath: r.workspacePath,
		prebuild: r.prebuild
			? {
					...r.prebuild,
					sessions: r.prebuild.sessions ?? [],
				}
			: null,
	}));
}

/**
 * Get repos linked to a prebuild.
 */
export async function getReposForPrebuild(prebuildId: string): Promise<SnapshotRepoRow[]> {
	const db = getDb();
	const results = await db.query.prebuildRepos.findMany({
		where: eq(prebuildRepos.prebuildId, prebuildId),
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
// Managed Prebuild queries
// ============================================

/**
 * Find managed prebuilds with their repos.
 */
export async function findManagedPrebuilds(): Promise<ManagedPrebuildRow[]> {
	const db = getDb();
	const results = await db.query.prebuilds.findMany({
		where: eq(prebuilds.type, "managed"),
		orderBy: [desc(prebuilds.createdAt)],
		columns: {
			id: true,
			snapshotId: true,
		},
		with: {
			prebuildRepos: {
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
 * Create a managed prebuild record.
 */
export async function createManagedPrebuild(input: CreateManagedPrebuildInput): Promise<void> {
	const db = getDb();
	await db.insert(prebuilds).values({
		id: input.id,
		type: "managed",
		status: "building",
		snapshotId: null,
		name: "Managed Prebuild",
	});
}

/**
 * Delete a prebuild by ID (for cleanup on failure).
 */
export async function deletePrebuild(id: string): Promise<void> {
	const db = getDb();
	await db.delete(prebuilds).where(eq(prebuilds.id, id));
}

/**
 * Get repos for an organization by IDs (or all if no IDs provided).
 */
export async function getReposForManagedPrebuild(
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
