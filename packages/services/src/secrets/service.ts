/**
 * Secrets service.
 *
 * Business logic that orchestrates DB operations.
 */

import type { Secret, SecretBundle } from "@proliferate/shared";
import { isValidTargetPath, parseEnvFile } from "@proliferate/shared";
import { decrypt, encrypt, getEncryptionKey } from "../db/crypto";
import * as secretsDb from "./db";
import { toBundle, toBundles, toSecret, toSecrets } from "./mapper";

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
	bundleId?: string;
}

export interface CheckSecretsInput {
	organizationId: string;
	keys: string[];
	repoId?: string;
	prebuildId?: string;
}

export interface CheckSecretsResult {
	key: string;
	exists: boolean;
}

export interface CreateBundleInput {
	organizationId: string;
	userId: string;
	name: string;
	description?: string;
	targetPath?: string;
}

export interface UpdateBundleInput {
	name?: string;
	description?: string | null;
	targetPath?: string | null;
}

export interface BulkImportSecretsInput {
	organizationId: string;
	userId: string;
	envText: string;
	bundleId?: string;
}

export interface BulkImportResult {
	created: number;
	skipped: string[];
}

export class InvalidTargetPathError extends Error {
	constructor(path: string) {
		super(`Invalid target path: "${path}"`);
		this.name = "InvalidTargetPathError";
	}
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

export class DuplicateBundleError extends Error {
	constructor(name: string) {
		super(`A bundle with name "${name}" already exists`);
		this.name = "DuplicateBundleError";
	}
}

export class BundleNotFoundError extends Error {
	constructor() {
		super("Bundle not found");
		this.name = "BundleNotFoundError";
	}
}

export class BundleOrgMismatchError extends Error {
	constructor() {
		super("Bundle does not belong to this organization");
		this.name = "BundleOrgMismatchError";
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

	// Validate bundle belongs to the same org
	if (input.bundleId) {
		const owned = await secretsDb.bundleBelongsToOrg(input.bundleId, input.organizationId);
		if (!owned) throw new BundleOrgMismatchError();
	}

	try {
		const row = await secretsDb.create({
			organizationId: input.organizationId,
			key: input.key,
			encryptedValue,
			description: input.description,
			repoId: input.repoId,
			secretType: input.secretType,
			bundleId: input.bundleId,
			createdBy: input.userId,
		});

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
	const existingKeys = await secretsDb.findExistingKeys(input.organizationId, {
		keys: input.keys,
		repoId: input.repoId,
		prebuildId: input.prebuildId,
	});

	const existingSet = new Set(existingKeys);

	return input.keys.map((key) => ({
		key,
		exists: existingSet.has(key),
	}));
}

/**
 * Update a secret's bundle assignment.
 */
export async function updateSecretBundle(
	id: string,
	orgId: string,
	bundleId: string | null,
): Promise<boolean> {
	// Validate bundle belongs to the same org
	if (bundleId) {
		const owned = await secretsDb.bundleBelongsToOrg(bundleId, orgId);
		if (!owned) throw new BundleOrgMismatchError();
	}
	return secretsDb.updateSecretBundle(id, orgId, bundleId);
}

// ============================================
// Bundle service functions
// ============================================

/**
 * List all bundles for an organization.
 */
export async function listBundles(orgId: string): Promise<SecretBundle[]> {
	const rows = await secretsDb.listBundlesByOrganization(orgId);
	return toBundles(rows);
}

/**
 * Create a new bundle.
 */
export async function createBundle(input: CreateBundleInput): Promise<SecretBundle> {
	if (input.targetPath !== undefined && input.targetPath !== null && !isValidTargetPath(input.targetPath)) {
		throw new InvalidTargetPathError(input.targetPath);
	}
	try {
		const row = await secretsDb.createBundle({
			organizationId: input.organizationId,
			name: input.name,
			description: input.description,
			targetPath: input.targetPath,
			createdBy: input.userId,
		});
		return toBundle(row);
	} catch (err: unknown) {
		if (err && typeof err === "object" && "code" in err && err.code === "23505") {
			throw new DuplicateBundleError(input.name);
		}
		throw err;
	}
}

/**
 * Update a bundle.
 */
export async function updateBundleMeta(
	id: string,
	orgId: string,
	input: UpdateBundleInput,
): Promise<SecretBundle> {
	if (input.targetPath !== undefined && input.targetPath !== null && !isValidTargetPath(input.targetPath)) {
		throw new InvalidTargetPathError(input.targetPath);
	}
	const row = await secretsDb.updateBundle(id, orgId, input);
	if (!row) throw new BundleNotFoundError();
	return toBundle(row);
}

/**
 * Delete a bundle. Secrets linked to this bundle become unbundled.
 */
export async function deleteBundle(id: string, orgId: string): Promise<boolean> {
	await secretsDb.deleteBundle(id, orgId);
	return true;
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

	// Validate bundle ownership
	if (input.bundleId) {
		const owned = await secretsDb.bundleBelongsToOrg(input.bundleId, input.organizationId);
		if (!owned) throw new BundleOrgMismatchError();
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
		bundleId: input.bundleId,
		createdBy: input.userId,
	}));

	const createdKeys = await secretsDb.bulkCreateSecrets(dbEntries);
	const createdSet = new Set(createdKeys);
	const skipped = entries.filter((e) => !createdSet.has(e.key)).map((e) => e.key);

	return { created: createdKeys.length, skipped };
}

// ============================================
// Runtime env file generation
// ============================================

/**
 * Build EnvFileSpec entries from bundles that have a target_path.
 * Used at session creation to inject bundled secrets as .env files.
 */
export async function buildEnvFilesFromBundles(
	orgId: string,
): Promise<Array<{ workspacePath: string; path: string; format: string; mode: string; keys: Array<{ key: string; required: boolean }> }>> {
	const bundles = await secretsDb.getBundlesWithTargetPath(orgId);
	return bundles.map((b) => ({
		workspacePath: ".",
		path: b.targetPath,
		format: "env",
		mode: "secret",
		keys: b.keys.map((key) => ({ key, required: false })),
	}));
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
