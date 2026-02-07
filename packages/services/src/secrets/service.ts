/**
 * Secrets service.
 *
 * Business logic that orchestrates DB operations.
 */

import type { Secret } from "@proliferate/shared";
import { encrypt, getEncryptionKey } from "../db/crypto";
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
// Service functions
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
