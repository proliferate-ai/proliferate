/**
 * Secret Files service.
 *
 * Business logic for config-scoped env file definitions and their secrets.
 */

import { decrypt, encrypt, getEncryptionKey } from "../db/crypto";
import { getServicesLogger } from "../logger";
import * as secretFilesDb from "./db";

// ============================================
// Types
// ============================================

export interface DecryptedBootSecrets {
	workspacePath: string;
	filePath: string;
	mode: string;
	vars: Record<string, string>;
}

// ============================================
// Service functions
// ============================================

/**
 * List secret files for a configuration (without encrypted values).
 */
export async function listSecretFiles(configurationId: string) {
	return secretFilesDb.listByConfiguration(configurationId);
}

/**
 * Create a new secret file definition.
 */
export async function createSecretFile(input: {
	configurationId: string;
	workspacePath?: string;
	filePath: string;
	mode?: string;
}) {
	return secretFilesDb.createSecretFile(input);
}

/**
 * Delete a secret file and all its secrets.
 */
export async function deleteSecretFile(id: string): Promise<void> {
	await secretFilesDb.deleteSecretFile(id);
}

/**
 * Delete a secret file scoped to a configuration (ownership check).
 */
export async function deleteSecretFileByConfiguration(
	id: string,
	configurationId: string,
): Promise<boolean> {
	return secretFilesDb.deleteSecretFileByConfiguration(id, configurationId);
}

/**
 * Find a secret file by ID scoped to a configuration (ownership check).
 */
export async function findSecretFileByConfiguration(id: string, configurationId: string) {
	return secretFilesDb.findSecretFileByConfiguration(id, configurationId);
}

/**
 * Delete a configuration secret scoped to a configuration (ownership check).
 */
export async function deleteSecretByConfiguration(
	secretId: string,
	configurationId: string,
): Promise<boolean> {
	return secretFilesDb.deleteSecretByConfiguration(secretId, configurationId);
}

/**
 * Upsert a secret value for a secret file.
 */
export async function upsertSecret(input: {
	secretFileId: string;
	key: string;
	encryptedValue?: string | null;
	required?: boolean;
}) {
	return secretFilesDb.upsertSecret(input);
}

/**
 * Upsert a secret with a plaintext value (encrypts before storing).
 */
export async function upsertSecretValue(input: {
	secretFileId: string;
	key: string;
	value: string;
	required?: boolean;
}) {
	const encryptionKey = getEncryptionKey();
	const encryptedValue = encrypt(input.value, encryptionKey);
	return secretFilesDb.upsertSecret({
		secretFileId: input.secretFileId,
		key: input.key,
		encryptedValue,
		required: input.required,
	});
}

/**
 * Delete a configuration secret.
 */
export async function deleteSecret(id: string): Promise<void> {
	await secretFilesDb.deleteSecret(id);
}

/**
 * Get decrypted secrets for session boot (config-scoped only).
 * Returns files with decrypted key-value pairs ready for sandbox injection.
 */
export async function getSecretsForBoot(configurationId: string): Promise<DecryptedBootSecrets[]> {
	const log = getServicesLogger().child({ module: "secret-files" });
	const bootRows = await secretFilesDb.getSecretsForBoot(configurationId);

	if (bootRows.length === 0) return [];

	let encryptionKey: string;
	try {
		encryptionKey = getEncryptionKey();
	} catch {
		log.warn("Encryption key not configured, skipping config secrets");
		return [];
	}

	return bootRows.map((file) => {
		const vars: Record<string, string> = {};
		for (const secret of file.keys) {
			try {
				vars[secret.key] = decrypt(secret.encryptedValue, encryptionKey);
			} catch (err) {
				log.warn({ key: secret.key, err }, "Failed to decrypt config secret");
			}
		}
		return {
			workspacePath: file.workspacePath,
			filePath: file.filePath,
			mode: file.mode,
			vars,
		};
	});
}
