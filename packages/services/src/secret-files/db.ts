/**
 * Secret Files DB operations.
 *
 * Raw Drizzle queries for config-scoped env file definitions and their secrets.
 */

import {
	type InferSelectModel,
	and,
	configurationSecrets,
	desc,
	eq,
	getDb,
	isNotNull,
	secretFiles,
} from "../db/client";

// ============================================
// Types
// ============================================

export type SecretFileRow = InferSelectModel<typeof secretFiles>;
export type ConfigurationSecretRow = InferSelectModel<typeof configurationSecrets>;

export interface SecretFileWithKeysRow extends SecretFileRow {
	configurationSecrets: Array<{
		id: string;
		key: string;
		encryptedValue: string | null;
		required: boolean;
	}>;
}

export interface SecretForBootRow {
	workspacePath: string;
	filePath: string;
	mode: string;
	keys: Array<{
		key: string;
		encryptedValue: string;
		required: boolean;
	}>;
}

// ============================================
// Secret Files Queries
// ============================================

/**
 * List secret files for a prebuild with their keys (no encrypted values).
 */
export async function listByPrebuild(prebuildId: string): Promise<SecretFileWithKeysRow[]> {
	const db = getDb();
	const rows = await db.query.secretFiles.findMany({
		where: eq(secretFiles.prebuildId, prebuildId),
		orderBy: [desc(secretFiles.createdAt)],
		with: {
			configurationSecrets: {
				columns: {
					id: true,
					key: true,
					encryptedValue: true,
					required: true,
				},
			},
		},
	});

	// Strip encrypted values for listing
	return rows.map((r) => ({
		...r,
		configurationSecrets: r.configurationSecrets.map((s) => ({
			...s,
			encryptedValue: s.encryptedValue ? "[encrypted]" : null,
		})),
	}));
}

/**
 * Create a new secret file definition.
 */
export async function createSecretFile(input: {
	prebuildId: string;
	workspacePath?: string;
	filePath: string;
	mode?: string;
}): Promise<SecretFileRow> {
	const db = getDb();
	const [row] = await db
		.insert(secretFiles)
		.values({
			prebuildId: input.prebuildId,
			workspacePath: input.workspacePath ?? ".",
			filePath: input.filePath,
			mode: input.mode ?? "secret",
		})
		.returning();
	return row;
}

/**
 * Find a secret file by prebuild + workspace + file path.
 */
export async function findSecretFile(
	prebuildId: string,
	workspacePath: string,
	filePath: string,
): Promise<SecretFileRow | null> {
	const db = getDb();
	const row = await db.query.secretFiles.findFirst({
		where: and(
			eq(secretFiles.prebuildId, prebuildId),
			eq(secretFiles.workspacePath, workspacePath),
			eq(secretFiles.filePath, filePath),
		),
	});
	return row ?? null;
}

/**
 * Delete a secret file and all its secrets (CASCADE).
 */
export async function deleteSecretFile(id: string): Promise<void> {
	const db = getDb();
	await db.delete(secretFiles).where(eq(secretFiles.id, id));
}

// ============================================
// Configuration Secrets Queries
// ============================================

/**
 * Upsert a secret (insert or update by secret_file_id + key).
 */
export async function upsertSecret(input: {
	secretFileId: string;
	key: string;
	encryptedValue?: string | null;
	required?: boolean;
}): Promise<ConfigurationSecretRow> {
	const db = getDb();
	const [row] = await db
		.insert(configurationSecrets)
		.values({
			secretFileId: input.secretFileId,
			key: input.key,
			encryptedValue: input.encryptedValue ?? null,
			required: input.required ?? false,
		})
		.onConflictDoUpdate({
			target: [configurationSecrets.secretFileId, configurationSecrets.key],
			set: {
				encryptedValue: input.encryptedValue ?? null,
				required: input.required ?? false,
				updatedAt: new Date(),
			},
		})
		.returning();
	return row;
}

/**
 * Delete a configuration secret by ID.
 */
export async function deleteSecret(id: string): Promise<void> {
	const db = getDb();
	await db.delete(configurationSecrets).where(eq(configurationSecrets.id, id));
}

// ============================================
// Boot-time queries
// ============================================

/**
 * Get secrets for session boot (config-scoped only).
 * Returns secret files with their non-null encrypted values grouped by file.
 */
export async function getSecretsForBoot(prebuildId: string): Promise<SecretForBootRow[]> {
	const db = getDb();
	const rows = await db.query.secretFiles.findMany({
		where: eq(secretFiles.prebuildId, prebuildId),
		with: {
			configurationSecrets: {
				columns: {
					key: true,
					encryptedValue: true,
					required: true,
				},
				where: isNotNull(configurationSecrets.encryptedValue),
			},
		},
	});

	return rows
		.filter((r) => r.configurationSecrets.length > 0)
		.map((r) => ({
			workspacePath: r.workspacePath,
			filePath: r.filePath,
			mode: r.mode,
			keys: r.configurationSecrets.map((s) => ({
				key: s.key,
				encryptedValue: s.encryptedValue!,
				required: s.required,
			})),
		}));
}

/**
 * Save env file spec from agent tool (creates secret_files + placeholder secrets).
 * Used by the save_env_files agent tool.
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
	const db = getDb();

	for (const file of files) {
		// Upsert secret_file
		const [sf] = await db
			.insert(secretFiles)
			.values({
				prebuildId,
				workspacePath: file.workspacePath,
				filePath: file.path,
				mode: file.mode,
			})
			.onConflictDoUpdate({
				target: [secretFiles.prebuildId, secretFiles.workspacePath, secretFiles.filePath],
				set: {
					mode: file.mode,
					updatedAt: new Date(),
				},
			})
			.returning();

		// Upsert placeholder secrets (encrypted_value = null)
		for (const key of file.keys) {
			await db
				.insert(configurationSecrets)
				.values({
					secretFileId: sf.id,
					key: key.key,
					required: key.required,
				})
				.onConflictDoUpdate({
					target: [configurationSecrets.secretFileId, configurationSecrets.key],
					set: {
						required: key.required,
						updatedAt: new Date(),
					},
				});
		}
	}
}
