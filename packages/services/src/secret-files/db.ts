/**
 * Secret Files DB operations.
 *
 * Raw Drizzle queries for the secret_files table.
 */

import { type InferSelectModel, and, eq, getDb, secretFiles } from "../db/client";

// ============================================
// Types
// ============================================

export type SecretFileRow = InferSelectModel<typeof secretFiles>;

/** Metadata returned to the frontend (no encrypted content). */
export type SecretFileMeta = Pick<
	SecretFileRow,
	| "id"
	| "organizationId"
	| "configurationId"
	| "filePath"
	| "description"
	| "createdBy"
	| "createdAt"
	| "updatedAt"
>;

/** Secret file payload used at sandbox boot (includes encrypted content). */
export type SecretFileBootRow = Pick<
	SecretFileRow,
	"id" | "organizationId" | "configurationId" | "filePath" | "encryptedContent" | "updatedAt"
>;

// ============================================
// Queries
// ============================================

/**
 * List secret files for a configuration (metadata only, no content).
 */
export async function listByConfiguration(
	orgId: string,
	configurationId: string,
): Promise<SecretFileMeta[]> {
	const db = getDb();
	const results = await db.query.secretFiles.findMany({
		where: and(
			eq(secretFiles.organizationId, orgId),
			eq(secretFiles.configurationId, configurationId),
		),
		columns: {
			id: true,
			organizationId: true,
			configurationId: true,
			filePath: true,
			description: true,
			createdBy: true,
			createdAt: true,
			updatedAt: true,
		},
	});

	return results;
}

/**
 * List encrypted secret file rows for boot-time decrypt/injection.
 */
export async function listEncryptedByConfiguration(
	orgId: string,
	configurationId: string,
): Promise<SecretFileBootRow[]> {
	const db = getDb();
	return db.query.secretFiles.findMany({
		where: and(
			eq(secretFiles.organizationId, orgId),
			eq(secretFiles.configurationId, configurationId),
		),
		columns: {
			id: true,
			organizationId: true,
			configurationId: true,
			filePath: true,
			encryptedContent: true,
			updatedAt: true,
		},
	});
}

/**
 * Upsert a secret file (create or update by org + configuration + filePath).
 */
export async function upsert(input: {
	organizationId: string;
	configurationId: string;
	filePath: string;
	encryptedContent: string;
	description?: string | null;
	createdBy: string;
}): Promise<SecretFileMeta> {
	const db = getDb();

	const [result] = await db
		.insert(secretFiles)
		.values({
			organizationId: input.organizationId,
			configurationId: input.configurationId,
			filePath: input.filePath,
			encryptedContent: input.encryptedContent,
			description: input.description ?? null,
			createdBy: input.createdBy,
		})
		.onConflictDoUpdate({
			target: [secretFiles.organizationId, secretFiles.configurationId, secretFiles.filePath],
			set: {
				encryptedContent: input.encryptedContent,
				description: input.description ?? null,
				updatedAt: new Date(),
			},
		})
		.returning({
			id: secretFiles.id,
			organizationId: secretFiles.organizationId,
			configurationId: secretFiles.configurationId,
			filePath: secretFiles.filePath,
			description: secretFiles.description,
			createdBy: secretFiles.createdBy,
			createdAt: secretFiles.createdAt,
			updatedAt: secretFiles.updatedAt,
		});

	return result;
}

/**
 * Delete a secret file by ID within an org.
 */
export async function deleteById(id: string, orgId: string): Promise<boolean> {
	const db = getDb();
	const result = await db
		.delete(secretFiles)
		.where(and(eq(secretFiles.id, id), eq(secretFiles.organizationId, orgId)))
		.returning({ id: secretFiles.id });

	return result.length > 0;
}
