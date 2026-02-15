/**
 * Secrets mapper.
 *
 * Transforms DB rows to API response types.
 */

import type { Secret } from "@proliferate/shared";
import type { SecretListRow } from "../types/secrets";

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
		configuration_id: row.configuration_id,
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
