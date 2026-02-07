/**
 * Secrets DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import {
	type InferSelectModel,
	type SQL,
	and,
	desc,
	eq,
	getDb,
	inArray,
	isNull,
	or,
	secrets,
} from "../db/client";
import { getServicesLogger } from "../logger";
import { toIsoString } from "../db/serialize";
import type {
	CheckSecretsFilter,
	DbCreateSecretInput,
	SecretForSessionRow,
	SecretListRow,
	UpsertSecretInput,
} from "../types/secrets";

// ============================================
// Types
// ============================================

export type SecretRow = InferSelectModel<typeof secrets>;

// ============================================
// Queries
// ============================================

/**
 * List secrets for an organization (without encrypted values).
 */
export async function listByOrganization(orgId: string): Promise<SecretListRow[]> {
	const db = getDb();
	const rows = await db
		.select({
			id: secrets.id,
			key: secrets.key,
			description: secrets.description,
			secretType: secrets.secretType,
			repoId: secrets.repoId,
			createdAt: secrets.createdAt,
			updatedAt: secrets.updatedAt,
		})
		.from(secrets)
		.where(eq(secrets.organizationId, orgId))
		.orderBy(desc(secrets.createdAt));

	// Map camelCase to snake_case for API contract
	return rows.map((row) => ({
		id: row.id,
		key: row.key,
		description: row.description,
		secret_type: row.secretType,
		repo_id: row.repoId,
		created_at: toIsoString(row.createdAt),
		updated_at: toIsoString(row.updatedAt),
	}));
}

/**
 * Create a new secret.
 */
export async function create(input: DbCreateSecretInput): Promise<SecretListRow> {
	const db = getDb();
	const [row] = await db
		.insert(secrets)
		.values({
			organizationId: input.organizationId,
			key: input.key,
			encryptedValue: input.encryptedValue,
			description: input.description ?? null,
			repoId: input.repoId ?? null,
			secretType: input.secretType ?? "env",
			createdBy: input.createdBy,
		})
		.returning({
			id: secrets.id,
			key: secrets.key,
			description: secrets.description,
			secretType: secrets.secretType,
			repoId: secrets.repoId,
			createdAt: secrets.createdAt,
			updatedAt: secrets.updatedAt,
		});

	// Map camelCase to snake_case for API contract
	return {
		id: row.id,
		key: row.key,
		description: row.description,
		secret_type: row.secretType,
		repo_id: row.repoId,
		created_at: toIsoString(row.createdAt),
		updated_at: toIsoString(row.updatedAt),
	};
}

/**
 * Delete a secret by ID within an organization.
 */
export async function deleteById(id: string, orgId: string): Promise<void> {
	const db = getDb();
	await db.delete(secrets).where(and(eq(secrets.id, id), eq(secrets.organizationId, orgId)));
}

/**
 * Check which secret keys exist for an organization.
 * Handles filtering by repo_id and prebuild_id.
 */
export async function findExistingKeys(
	orgId: string,
	filter: CheckSecretsFilter,
): Promise<string[]> {
	const db = getDb();

	// Build conditions based on filter
	let scopeCondition: SQL<unknown> | undefined;
	if (filter.repoId) {
		// Include org-wide secrets (repoId is null) and repo-specific secrets
		scopeCondition = or(isNull(secrets.repoId), eq(secrets.repoId, filter.repoId));
	} else {
		// Only org-wide secrets
		scopeCondition = isNull(secrets.repoId);
	}

	const rows = await db
		.select({ key: secrets.key })
		.from(secrets)
		.where(
			and(eq(secrets.organizationId, orgId), inArray(secrets.key, filter.keys), scopeCondition),
		);

	return rows.map((r) => r.key);
}

/**
 * Check if a secret with the given key exists in the organization.
 */
export async function existsByKey(orgId: string, key: string): Promise<boolean> {
	const db = getDb();
	const row = await db.query.secrets.findFirst({
		columns: { id: true },
		where: and(eq(secrets.organizationId, orgId), eq(secrets.key, key)),
	});

	return !!row;
}

/**
 * Get secrets for session injection (org-scoped and repo-scoped).
 */
export async function getSecretsForSession(
	orgId: string,
	repoIds: string[],
): Promise<SecretForSessionRow[]> {
	const db = getDb();

	// Include org-wide secrets (repoId is null) and repo-specific secrets
	const repoConditions = repoIds.map((id) => eq(secrets.repoId, id));
	const scopeCondition = or(isNull(secrets.repoId), ...repoConditions);

	const rows = await db
		.select({
			key: secrets.key,
			encryptedValue: secrets.encryptedValue,
		})
		.from(secrets)
		.where(and(eq(secrets.organizationId, orgId), scopeCondition));

	return rows;
}

/**
 * Upsert a secret (insert or update by repo_id,key).
 * Returns true on success.
 */
export async function upsertByRepoAndKey(input: UpsertSecretInput): Promise<boolean> {
	const db = getDb();
	try {
		await db
			.insert(secrets)
			.values({
				repoId: input.repoId,
				organizationId: input.organizationId,
				key: input.key,
				encryptedValue: input.encryptedValue,
			})
			.onConflictDoUpdate({
				target: [secrets.organizationId, secrets.repoId, secrets.key],
				set: {
					encryptedValue: input.encryptedValue,
					updatedAt: new Date(),
				},
			});
		return true;
	} catch (error) {
		getServicesLogger().child({ module: "secrets-db" }).error({ err: error, secretKey: input.key }, "Failed to store secret");
		return false;
	}
}
