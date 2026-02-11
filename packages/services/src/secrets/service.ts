/**
 * Secrets service.
 *
 * Business logic that orchestrates DB operations.
 */

import type { Secret, SecretBundle } from "@proliferate/shared";
import { encrypt, getEncryptionKey } from "../db/crypto";
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
}

export interface UpdateBundleInput {
	name?: string;
	description?: string | null;
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
	try {
		const row = await secretsDb.createBundle({
			organizationId: input.organizationId,
			name: input.name,
			description: input.description,
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
