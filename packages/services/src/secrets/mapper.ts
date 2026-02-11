/**
 * Secrets mapper.
 *
 * Transforms DB rows to API response types.
 */

import type { Secret, SecretBundle } from "@proliferate/shared";
import type { SecretBundleListRow, SecretListRow } from "../types/secrets";

/**
 * Map a DB row to API Secret type.
 */
export function toSecret(row: SecretListRow): Secret {
	return {
		id: row.id,
		key: row.key,
		description: row.description,
		secret_type: row.secret_type,
		repo_id: row.repo_id,
		bundle_id: row.bundle_id,
		created_at: row.created_at,
		updated_at: row.updated_at ?? null,
	};
}

/**
 * Map multiple DB rows to API Secret types.
 */
export function toSecrets(rows: SecretListRow[]): Secret[] {
	return rows.map(toSecret);
}

/**
 * Map a DB row to API SecretBundle type.
 */
export function toBundle(row: SecretBundleListRow): SecretBundle {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		target_path: row.target_path,
		secret_count: row.secret_count,
		created_at: row.created_at,
		updated_at: row.updated_at ?? null,
	};
}

/**
 * Map multiple DB rows to API SecretBundle types.
 */
export function toBundles(rows: SecretBundleListRow[]): SecretBundle[] {
	return rows.map(toBundle);
}
