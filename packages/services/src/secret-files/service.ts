/**
 * Secret Files service.
 *
 * Business logic layer that handles encryption before storage.
 */

import { encrypt, getEncryptionKey } from "../db/crypto";
import type { SecretFileBootRow, SecretFileMeta } from "./db";
import * as secretFilesDb from "./db";

// Re-export types for consumers
export type { SecretFileMeta, SecretFileBootRow } from "./db";

/**
 * List secret files for a configuration (metadata only, no content).
 */
export async function listByConfiguration(
	orgId: string,
	configurationId: string,
): Promise<SecretFileMeta[]> {
	return secretFilesDb.listByConfiguration(orgId, configurationId);
}

/**
 * List encrypted secret file rows for boot-time decrypt/injection.
 */
export async function listEncryptedByConfiguration(
	orgId: string,
	configurationId: string,
): Promise<SecretFileBootRow[]> {
	return secretFilesDb.listEncryptedByConfiguration(orgId, configurationId);
}

/**
 * Delete a secret file by ID within an org.
 */
export async function deleteById(id: string, orgId: string): Promise<boolean> {
	return secretFilesDb.deleteById(id, orgId);
}

/**
 * Upsert a secret file — encrypts content and stores it.
 */
export async function upsertSecretFile(input: {
	organizationId: string;
	configurationId: string;
	filePath: string;
	content: string;
	description?: string | null;
	createdBy: string;
}): Promise<SecretFileMeta> {
	const encryptionKey = getEncryptionKey();
	const encryptedContent = encrypt(input.content, encryptionKey);

	return secretFilesDb.upsert({
		organizationId: input.organizationId,
		configurationId: input.configurationId,
		filePath: input.filePath,
		encryptedContent,
		description: input.description,
		createdBy: input.createdBy,
	});
}
