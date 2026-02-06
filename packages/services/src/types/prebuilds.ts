/**
 * Prebuilds module types.
 *
 * Input types for prebuilds queries.
 * DB row types are exported from ../prebuilds/db.ts
 */

// ============================================
// Input Types
// ============================================

export interface CreatePrebuildInput {
	id: string;
	name?: string | null;
	createdBy: string;
	sandboxProvider?: string;
}

export interface CreatePrebuildRepoInput {
	prebuildId: string;
	repoId: string;
	workspacePath: string;
}

export interface UpdatePrebuildInput {
	name?: string | null;
	notes?: string | null;
	snapshotId?: string;
	status?: string;
}

export interface CreatePrebuildFullInput {
	id: string;
	snapshotId: string;
	status: string;
	name?: string | null;
	notes?: string | null;
	createdBy: string;
	sandboxProvider?: string;
}

// ============================================
// Managed Prebuild Types
// ============================================

/** Input for creating a managed prebuild. */
export interface CreateManagedPrebuildInput {
	id: string;
}

// ============================================
// Snapshot Types
// ============================================

/** Full snapshot row with repos (API response shape). */
export interface SnapshotRow {
	id: string;
	snapshot_id: string | null;
	status: string | null;
	name: string | null;
	notes: string | null;
	created_at: string;
	created_by: string | null;
	setup_sessions?: Array<{ id: string; session_type: string | null }>;
	repos: Array<{ id: string; github_repo_name: string }>;
	repoCount: number;
}
