/**
 * Secrets service.
 *
 * Business logic that orchestrates DB operations.
 */

import type { Secret } from "@proliferate/shared/contracts/secrets";
import { parseEnvFile } from "@proliferate/shared";
import { decrypt, encrypt, getEncryptionKey } from "../db/crypto";
import type { SecretForSessionRow, UpsertSecretInput } from "../types/secrets";
import * as secretsDb from "./db";
import { toSecret, toSecrets } from "./mapper";

// ============================================
// Types
// ============================================

export interface CreateSecretInput {
	organizationId: string;
	userId: string;
	key: string;
	value: string;
	description?: string;
	repoId?: string;
	secretType?: string;
	configurationId?: string;
}

export interface CheckSecretsInput {
	organizationId: string;
	keys: string[];
	repoId?: string;
	configurationId?: string;
}

export interface CheckSecretsResult {
	key: string;
	exists: boolean;
}

export interface BulkImportSecretsInput {
	organizationId: string;
	userId: string;
	envText: string;
}

export interface BulkImportResult {
	created: number;
	skipped: string[];
}

// ============================================
// Error types
// ============================================

export class EncryptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EncryptionError";
	}
}

export class DuplicateSecretError extends Error {
	constructor(key: string) {
		super(`A secret with key "${key}" already exists`);
		this.name = "DuplicateSecretError";
	}
}

// ============================================
// Secrets service functions
// ============================================

/**
 * List all secrets for an organization.
 * Values are never returned.
 */
export async function listSecrets(orgId: string): Promise<Secret[]> {
	const rows = await secretsDb.listByOrganization(orgId);
	return toSecrets(rows);
}

/**
 * Create a new secret.
 * Encrypts the value before storing.
 */
export async function createSecret(input: CreateSecretInput): Promise<Secret> {
	// Encrypt the value
	let encryptedValue: string;
	try {
		const encryptionKey = getEncryptionKey();
		encryptedValue = encrypt(input.value, encryptionKey);
	} catch (err) {
		throw new EncryptionError("Encryption not configured");
	}

	try {
		const row = await secretsDb.create({
			organizationId: input.organizationId,
			key: input.key,
			encryptedValue,
			description: input.description,
			repoId: input.repoId,
			secretType: input.secretType,
			createdBy: input.userId,
		});

		if (input.configurationId && row.id) {
			await secretsDb.linkSecretToConfiguration(input.configurationId, row.id);
		}

		return toSecret(row);
	} catch (err: unknown) {
		// Check for unique constraint violation
		if (err && typeof err === "object" && "code" in err && err.code === "23505") {
			throw new DuplicateSecretError(input.key);
		}
		throw err;
	}
}

/**
 * Delete a secret.
 */
export async function deleteSecret(id: string, orgId: string): Promise<boolean> {
	await secretsDb.deleteById(id, orgId);
	return true;
}

/**
 * Check which secrets exist for given keys.
 */
export async function checkSecrets(input: CheckSecretsInput): Promise<CheckSecretsResult[]> {
	let existingKeys: string[];
	if (input.configurationId) {
		existingKeys = await secretsDb.findExistingKeysForConfiguration(
			input.organizationId, input.configurationId, input.keys,
		);
	} else {
		existingKeys = await secretsDb.findExistingKeys(input.organizationId, {
			keys: input.keys, repoId: input.repoId,
		});
	}

	const existingSet = new Set(existingKeys);

	return input.keys.map((key) => ({
		key,
		exists: existingSet.has(key),
	}));
}

// ============================================
// Bulk import
// ============================================

/**
 * Bulk-import secrets from pasted .env text.
 * Parses the text, encrypts values, inserts secrets (skipping duplicates).
 */
export async function bulkImportSecrets(input: BulkImportSecretsInput): Promise<BulkImportResult> {
	const entries = parseEnvFile(input.envText);
	if (entries.length === 0) {
		return { created: 0, skipped: [] };
	}

	// Encrypt all values
	let encryptionKey: string;
	try {
		encryptionKey = getEncryptionKey();
	} catch {
		throw new EncryptionError("Encryption not configured");
	}

	const dbEntries = entries.map((e) => ({
		organizationId: input.organizationId,
		key: e.key,
		encryptedValue: encrypt(e.value, encryptionKey),
		createdBy: input.userId,
	}));

	const createdKeys = await secretsDb.bulkCreateSecrets(dbEntries);
	const createdSet = new Set(createdKeys);
	const skipped = entries.filter((e) => !createdSet.has(e.key)).map((e) => e.key);

	return { created: createdKeys.length, skipped };
}

// ============================================
// Session/configuration secret reads and upserts
// ============================================

/**
 * Get org/repo-scoped secrets for session boot env injection.
 */
export async function getSecretsForSession(
	orgId: string,
	repoIds: string[],
): Promise<SecretForSessionRow[]> {
	return secretsDb.getSecretsForSession(orgId, repoIds);
}

/**
 * Get org/repo-scoped secrets with scope metadata for precedence resolution.
 */
export async function getScopedSecretsForSession(
	orgId: string,
	repoIds: string[],
): Promise<secretsDb.ScopedSecretForSessionRow[]> {
	return secretsDb.getScopedSecretsForSession(orgId, repoIds);
}

/**
 * Get configuration-linked secrets for session boot env injection.
 */
export async function getSecretsForConfiguration(
	orgId: string,
	configurationId: string,
): Promise<SecretForSessionRow[]> {
	return secretsDb.getSecretsForConfiguration(orgId, configurationId);
}

/**
 * Get configuration-linked secrets with metadata for precedence resolution.
 */
export async function getScopedSecretsForConfiguration(
	orgId: string,
	configurationId: string,
): Promise<secretsDb.ScopedSecretForSessionRow[]> {
	return secretsDb.getScopedSecretsForConfiguration(orgId, configurationId);
}

/**
 * Upsert a repo-scoped secret value by key.
 */
export async function upsertSecretByRepoAndKey(input: {
	repoId: UpsertSecretInput["repoId"];
	organizationId: UpsertSecretInput["organizationId"];
	key: UpsertSecretInput["key"];
	encryptedValue: UpsertSecretInput["encryptedValue"];
}): Promise<boolean> {
	return secretsDb.upsertByRepoAndKey(input);
}

// ============================================
// Connector secret resolution
// ============================================

/**
 * Resolve a single org-wide secret value by key.
 * Used by the gateway to resolve connector auth credentials at runtime.
 * Returns the decrypted plaintext or null if not found.
 */
export async function resolveSecretValue(orgId: string, key: string): Promise<string | null> {
	const row = await secretsDb.getSecretByOrgAndKey(orgId, key);
	if (!row) return null;
	try {
		return decrypt(row.encryptedValue, getEncryptionKey());
	} catch {
		return null;
	}
}

// ============================================
// Multi-repo secret assignment
// ============================================

/**
 * Assign a secret to multiple repos (upsert per repo).
 */
export async function assignSecretToRepos(input: {
	orgId: string;
	key: string;
	value: string;
	repoIds: string[];
}): Promise<void> {
	let encryptedValue: string;
	try {
		encryptedValue = encrypt(input.value, getEncryptionKey());
	} catch {
		throw new EncryptionError("Encryption not configured");
	}
	for (const repoId of input.repoIds) {
		await secretsDb.upsertByRepoAndKey({
			organizationId: input.orgId,
			repoId,
			key: input.key,
			encryptedValue,
		});
	}
}

/**
 * Update encrypted value for a secret across specific repos.
 */
export async function updateSecretValue(input: {
	orgId: string;
	key: string;
	newValue: string;
	repoIds: string[];
}): Promise<void> {
	let encryptedValue: string;
	try {
		encryptedValue = encrypt(input.newValue, getEncryptionKey());
	} catch {
		throw new EncryptionError("Encryption not configured");
	}
	await secretsDb.updateValueByKeyAndRepos(input.orgId, input.key, encryptedValue, input.repoIds);
}

/**
 * Remove a secret from specific repos.
 */
export async function removeSecretFromRepos(input: {
	orgId: string;
	key: string;
	repoIds: string[];
}): Promise<void> {
	await secretsDb.deleteByKeyAndRepos(input.orgId, input.key, input.repoIds);
}

/**
 * List secrets grouped by key with repo assignments.
 */
export async function listSecretsGrouped(orgId: string): Promise<secretsDb.GroupedSecretRow[]> {
	return secretsDb.listGroupedByKey(orgId);
}
