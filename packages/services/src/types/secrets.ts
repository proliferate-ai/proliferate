/**
 * Secrets module types.
 *
 * DB row shapes and input types for secrets queries.
 */

// ============================================
// DB Row Types
// ============================================

export interface SecretRow {
	id: string;
	organization_id: string;
	key: string;
	encrypted_value: string;
	description: string | null;
	secret_type: string | null;
	repo_id: string | null;
	prebuild_id: string | null;
	bundle_id: string | null;
	created_by: string;
	created_at: string | null;
	updated_at: string | null;
}

/** Fields returned when listing secrets (no encrypted value). */
export interface SecretListRow {
	id: string;
	key: string;
	description: string | null;
	secret_type: string | null;
	repo_id: string | null;
	bundle_id: string | null;
	created_at: string | null;
	updated_at: string | null;
}

/** Secret with encrypted value for session injection. */
export interface SecretForSessionRow {
	key: string;
	encryptedValue: string;
}

// ============================================
// Bundle Types
// ============================================

export interface SecretBundleListRow {
	id: string;
	name: string;
	description: string | null;
	target_path: string | null;
	secret_count: number;
	created_at: string | null;
	updated_at: string | null;
}

export interface DbCreateBundleInput {
	organizationId: string;
	name: string;
	description?: string;
	targetPath?: string;
	createdBy: string;
}

export interface DbUpdateBundleInput {
	name?: string;
	description?: string | null;
	targetPath?: string | null;
}

/** A bundle with target_path and its associated secret keys (for runtime env file generation). */
export interface BundleWithKeys {
	id: string;
	targetPath: string;
	keys: string[];
}

// ============================================
// Input Types
// ============================================

export interface DbCreateSecretInput {
	organizationId: string;
	key: string;
	encryptedValue: string;
	description?: string;
	repoId?: string;
	secretType?: string;
	bundleId?: string;
	createdBy: string;
}

export interface CheckSecretsFilter {
	keys: string[];
	repoId?: string;
	prebuildId?: string;
}

export interface UpsertSecretInput {
	repoId: string;
	organizationId: string;
	key: string;
	encryptedValue: string;
}
