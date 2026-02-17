/**
 * CLI module type definitions.
 *
 * Central location for all CLI-related types.
 */

// ============================================
// Device Code Types
// ============================================

export interface DeviceCodeRow {
	id: string;
	user_code: string;
	device_code: string;
	expires_at: string;
	status: string;
	user_id: string | null;
	org_id: string | null;
	authorized_at: string | null;
}

// ============================================
// SSH Key Types
// ============================================

export interface SshKeyRow {
	id: string;
	fingerprint: string;
	name: string | null;
	created_at: string | null;
}

export interface SshKeyWithPublicKey extends SshKeyRow {
	public_key: string;
}

// ============================================
// Repo Types
// ============================================

export interface CliRepoRow {
	id: string;
	local_path_hash: string | null;
	source: string | null;
	github_repo_name: string;
}

export interface CliRepoConnectionRow {
	id: string;
	integration_id: string | null;
	integrations: {
		id: string;
		integration_id: string;
		display_name: string | null;
		status: string;
	} | null;
}

// ============================================
// Session Types
// ============================================

export interface CliSessionRow {
	id: string;
	status: string | null;
	session_type: string | null;
	origin: string | null;
	local_path_hash: string | null;
	started_at: string | null;
	last_activity_at: string | null;
}

export interface CliSessionFullRow {
	id: string;
	status: string | null;
	sandbox_id: string | null;
	sandbox_provider: string | null;
	organization_id: string;
}

export interface CreateCliSessionInput {
	id: string;
	repoId: string | null;
	organizationId: string;
	createdBy: string;
	sessionType: string;
	origin: string;
	localPathHash: string;
	status: string;
	sandboxProvider: string;
	title: string;
}

export interface CreateCliSessionWithConfigurationInput {
	id: string;
	configurationId: string;
	organizationId: string;
	createdBy: string;
	sessionType: string;
	clientType: string;
	status: string;
	sandboxProvider: string;
	snapshotId: string | null;
}

// ============================================
// Configuration Types
// ============================================

export interface CliConfigurationRow {
	id: string;
	snapshot_id: string | null;
	user_id: string | null;
	local_path_hash: string | null;
	created_at: string | null;
	sandbox_provider: string | null;
}

// ============================================
// GitHub Integration Types
// ============================================

export interface GitHubIntegrationStatusRow {
	id: string;
	display_name: string | null;
}

export interface GitHubIntegrationForTokenRow {
	id: string;
	github_installation_id: number | null;
	connection_id: string | null;
}

export interface CliGitHubSelectionRow {
	connection_id: string;
	expires_at: string;
}
