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
	configuration_id: string | null;
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
	configuration_id: string | null;
	created_at: string | null;
	updated_at: string | null;
}

/** Secret with encrypted value for session injection. */
export interface SecretForSessionRow {
	key: string;
	encryptedValue: string;
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
	createdBy: string;
}

export interface CheckSecretsFilter {
	keys: string[];
	repoId?: string;
	configurationId?: string;
}

export interface UpsertSecretInput {
	repoId: string;
	organizationId: string;
	key: string;
	encryptedValue: string;
}
