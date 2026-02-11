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
	secretBundles,
	secrets,
	sql,
} from "../db/client";
import { getServicesLogger } from "../logger";
import { toIsoString } from "../db/serialize";
import type {
	CheckSecretsFilter,
	DbCreateBundleInput,
	DbCreateSecretInput,
	DbUpdateBundleInput,
	SecretBundleListRow,
	SecretForSessionRow,
	SecretListRow,
	UpsertSecretInput,
} from "../types/secrets";

// ============================================
// Types
// ============================================

export type SecretRow = InferSelectModel<typeof secrets>;

// ============================================
// Secrets Queries
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
			bundleId: secrets.bundleId,
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
		bundle_id: row.bundleId,
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
			bundleId: input.bundleId ?? null,
			createdBy: input.createdBy,
		})
		.returning({
			id: secrets.id,
			key: secrets.key,
			description: secrets.description,
			secretType: secrets.secretType,
			repoId: secrets.repoId,
			bundleId: secrets.bundleId,
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
		bundle_id: row.bundleId,
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

/**
 * Update a secret's bundle assignment.
 */
export async function updateSecretBundle(
	id: string,
	orgId: string,
	bundleId: string | null,
): Promise<boolean> {
	const db = getDb();
	const rows = await db
		.update(secrets)
		.set({ bundleId, updatedAt: new Date() })
		.where(and(eq(secrets.id, id), eq(secrets.organizationId, orgId)))
		.returning({ id: secrets.id });
	return rows.length > 0;
}

// ============================================
// Bundles Queries
// ============================================

/**
 * List all bundles for an organization with secret counts.
 */
export async function listBundlesByOrganization(
	orgId: string,
): Promise<SecretBundleListRow[]> {
	const db = getDb();
	const rows = await db
		.select({
			id: secretBundles.id,
			name: secretBundles.name,
			description: secretBundles.description,
			secretCount: sql<number>`count(${secrets.id})::int`,
			createdAt: secretBundles.createdAt,
			updatedAt: secretBundles.updatedAt,
		})
		.from(secretBundles)
		.leftJoin(secrets, eq(secrets.bundleId, secretBundles.id))
		.where(eq(secretBundles.organizationId, orgId))
		.groupBy(secretBundles.id)
		.orderBy(desc(secretBundles.createdAt));

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		description: row.description,
		secret_count: row.secretCount,
		created_at: toIsoString(row.createdAt),
		updated_at: toIsoString(row.updatedAt),
	}));
}

/**
 * Create a new bundle.
 */
export async function createBundle(
	input: DbCreateBundleInput,
): Promise<SecretBundleListRow> {
	const db = getDb();
	const [row] = await db
		.insert(secretBundles)
		.values({
			organizationId: input.organizationId,
			name: input.name,
			description: input.description ?? null,
			createdBy: input.createdBy,
		})
		.returning({
			id: secretBundles.id,
			name: secretBundles.name,
			description: secretBundles.description,
			createdAt: secretBundles.createdAt,
			updatedAt: secretBundles.updatedAt,
		});

	return {
		id: row.id,
		name: row.name,
		description: row.description,
		secret_count: 0,
		created_at: toIsoString(row.createdAt),
		updated_at: toIsoString(row.updatedAt),
	};
}

/**
 * Update a bundle's name and/or description.
 */
export async function updateBundle(
	id: string,
	orgId: string,
	input: DbUpdateBundleInput,
): Promise<SecretBundleListRow | null> {
	const db = getDb();
	const set: Record<string, unknown> = { updatedAt: new Date() };
	if (input.name !== undefined) set.name = input.name;
	if (input.description !== undefined) set.description = input.description;

	const [row] = await db
		.update(secretBundles)
		.set(set)
		.where(and(eq(secretBundles.id, id), eq(secretBundles.organizationId, orgId)))
		.returning({
			id: secretBundles.id,
			name: secretBundles.name,
			description: secretBundles.description,
			createdAt: secretBundles.createdAt,
			updatedAt: secretBundles.updatedAt,
		});

	if (!row) return null;

	// Fetch secret count separately
	const [countRow] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(secrets)
		.where(eq(secrets.bundleId, id));

	return {
		id: row.id,
		name: row.name,
		description: row.description,
		secret_count: countRow?.count ?? 0,
		created_at: toIsoString(row.createdAt),
		updated_at: toIsoString(row.updatedAt),
	};
}

/**
 * Delete a bundle by ID within an organization.
 * Secrets linked to this bundle will have bundle_id set to null (ON DELETE SET NULL).
 */
export async function deleteBundle(id: string, orgId: string): Promise<void> {
	const db = getDb();
	await db
		.delete(secretBundles)
		.where(and(eq(secretBundles.id, id), eq(secretBundles.organizationId, orgId)));
}
