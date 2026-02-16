/**
 * Secret Files service.
 *
 * Business logic layer that handles encryption before storage.
 */

import { encrypt, getEncryptionKey } from "../db/crypto";
import type { SecretFileMeta } from "./db";
import * as secretFilesDb from "./db";

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
