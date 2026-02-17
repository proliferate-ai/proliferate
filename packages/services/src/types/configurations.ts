/**
 * Configurations module types.
 *
 * Input types for configurations queries.
 * DB row types are exported from ../configurations/db.ts
 */

// ============================================
// Input Types
// ============================================

export interface CreateConfigurationInput {
	id: string;
	name?: string | null;
	createdBy: string;
	sandboxProvider?: string;
}

export interface CreateConfigurationRepoInput {
	configurationId: string;
	repoId: string;
	workspacePath: string;
}

export interface UpdateConfigurationInput {
	name?: string | null;
	notes?: string | null;
	snapshotId?: string;
	status?: string;
}

export interface CreateConfigurationFullInput {
	id: string;
	snapshotId: string;
	status: string;
	name?: string | null;
	notes?: string | null;
	createdBy: string;
	sandboxProvider?: string;
}

// ============================================
// Managed Configuration Types
// ============================================

/** Input for creating a managed configuration. */
export interface CreateManagedConfigurationInput {
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
