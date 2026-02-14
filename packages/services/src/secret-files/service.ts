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
 * List secret files for a prebuild (without encrypted values).
 */
export async function listSecretFiles(prebuildId: string) {
	return secretFilesDb.listByPrebuild(prebuildId);
}

/**
 * Create a new secret file definition.
 */
export async function createSecretFile(input: {
	prebuildId: string;
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
export async function getSecretsForBoot(prebuildId: string): Promise<DecryptedBootSecrets[]> {
	const log = getServicesLogger().child({ module: "secret-files" });
	const bootRows = await secretFilesDb.getSecretsForBoot(prebuildId);

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

/**
 * Save env file spec from agent tool (creates secret_files + placeholder secrets).
 * Dual-write target for the save_env_files gateway tool.
 */
export async function saveEnvFileSpec(
	prebuildId: string,
	files: Array<{
		workspacePath: string;
		path: string;
		format: string;
		mode: string;
		keys: Array<{ key: string; required: boolean }>;
	}>,
): Promise<void> {
	await secretFilesDb.saveEnvFileSpec(prebuildId, files);
}
