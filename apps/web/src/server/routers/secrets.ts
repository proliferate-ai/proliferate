/**
 * Secrets oRPC router.
 *
 * Handles organization secrets CRUD operations.
 */

import { ORPCError } from "@orpc/server";
import { configurations, secretFiles, secrets } from "@proliferate/services";
import {
	CheckSecretsInputSchema,
	CheckSecretsResultSchema,
	CreateSecretInputSchema,
	SecretSchema,
} from "@proliferate/shared";
import { z } from "zod";
import { orgProcedure } from "./middleware";

const BulkImportInputSchema = z.object({
	envText: z.string().min(1),
});

const BulkImportResultSchema = z.object({
	created: z.number(),
	skipped: z.array(z.string()),
});

export const secretsRouter = {
	/**
	 * List all secrets for the current organization.
	 * Values are never returned.
	 */
	list: orgProcedure
		.input(z.object({}).optional())
		.output(z.object({ secrets: z.array(SecretSchema) }))
		.handler(async ({ context }) => {
			const secretsList = await secrets.listSecrets(context.orgId);
			return { secrets: secretsList };
		}),

	/**
	 * Create a new secret.
	 * Value is encrypted before storing.
	 */
	create: orgProcedure
		.input(CreateSecretInputSchema)
		.output(z.object({ secret: SecretSchema.omit({ updated_at: true }) }))
		.handler(async ({ input, context }) => {
			try {
				const secret = await secrets.createSecret({
					organizationId: context.orgId,
					userId: context.user.id,
					key: input.key,
					value: input.value,
					description: input.description,
					repoId: input.repoId,
					secretType: input.secretType,
				});
				return { secret };
			} catch (err) {
				if (err instanceof secrets.DuplicateSecretError) {
					throw new ORPCError("CONFLICT", { message: err.message });
				}
				if (err instanceof secrets.EncryptionError) {
					throw new ORPCError("INTERNAL_SERVER_ERROR", { message: err.message });
				}
				throw err;
			}
		}),

	/**
	 * Delete a secret.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ deleted: z.boolean() }))
		.handler(async ({ input, context }) => {
			await secrets.deleteSecret(input.id, context.orgId);
			return { deleted: true };
		}),

	/**
	 * Check which secrets exist for given keys.
	 */
	check: orgProcedure
		.input(CheckSecretsInputSchema)
		.output(z.object({ keys: z.array(CheckSecretsResultSchema) }))
		.handler(async ({ input, context }) => {
			const results = await secrets.checkSecrets({
				organizationId: context.orgId,
				keys: input.keys,
				repoId: input.repo_id,
				configurationId: input.configuration_id,
			});
			return { keys: results };
		}),

	// ============================================
	// Bulk import
	// ============================================

	/**
	 * Bulk-import secrets from pasted .env text.
	 */
	bulkImport: orgProcedure
		.input(BulkImportInputSchema)
		.output(BulkImportResultSchema)
		.handler(async ({ input, context }) => {
			try {
				return await secrets.bulkImportSecrets({
					organizationId: context.orgId,
					userId: context.user.id,
					envText: input.envText,
				});
			} catch (err) {
				if (err instanceof secrets.EncryptionError) {
					throw new ORPCError("INTERNAL_SERVER_ERROR", { message: err.message });
				}
				throw err;
			}
		}),
};

// ============================================
// Secret Files Router (configuration-scoped env files)
// ============================================

const SecretFileKeySchema = z.object({
	id: z.string().uuid(),
	key: z.string(),
	hasValue: z.boolean(),
	required: z.boolean(),
});

const SecretFileSchema = z.object({
	id: z.string().uuid(),
	configurationId: z.string().uuid(),
	workspacePath: z.string(),
	filePath: z.string(),
	mode: z.string(),
	keys: z.array(SecretFileKeySchema),
});

/** Verify the configuration belongs to the caller's org. */
async function requireConfigurationAccess(configurationId: string, orgId: string) {
	const configuration = await configurations.findById(configurationId);
	if (!configuration) {
		throw new ORPCError("NOT_FOUND", { message: "Configuration not found" });
	}
	const configurationOrgId = configuration.configurationRepos?.[0]?.repo?.organizationId;
	if (configurationOrgId !== orgId) {
		throw new ORPCError("NOT_FOUND", { message: "Configuration not found" });
	}
}

export const secretFilesRouter = {
	/**
	 * List secret files for a configuration with their keys.
	 */
	list: orgProcedure
		.input(z.object({ configurationId: z.string().uuid() }))
		.output(z.object({ files: z.array(SecretFileSchema) }))
		.handler(async ({ input, context }) => {
			await requireConfigurationAccess(input.configurationId, context.orgId);
			const rows = await secretFiles.listSecretFiles(input.configurationId);
			const files = rows.map((r) => ({
				id: r.id,
				configurationId: r.configurationId,
				workspacePath: r.workspacePath,
				filePath: r.filePath,
				mode: r.mode,
				keys: r.configurationSecrets.map((s) => ({
					id: s.id,
					key: s.key,
					hasValue:
						s.encryptedValue !== null && s.encryptedValue !== "[encrypted]"
							? false
							: s.encryptedValue === "[encrypted]",
					required: s.required,
				})),
			}));
			return { files };
		}),

	/**
	 * Create a new secret file definition.
	 */
	createFile: orgProcedure
		.input(
			z.object({
				configurationId: z.string().uuid(),
				filePath: z.string().min(1).max(500),
				workspacePath: z.string().max(500).default("."),
				mode: z.enum(["secret"]).default("secret"),
			}),
		)
		.output(z.object({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await requireConfigurationAccess(input.configurationId, context.orgId);
			const file = await secretFiles.createSecretFile({
				configurationId: input.configurationId,
				filePath: input.filePath,
				workspacePath: input.workspacePath,
				mode: input.mode,
			});
			return { id: file.id };
		}),

	/**
	 * Delete a secret file and all its secrets.
	 */
	deleteFile: orgProcedure
		.input(z.object({ id: z.string().uuid(), configurationId: z.string().uuid() }))
		.output(z.object({ deleted: z.boolean() }))
		.handler(async ({ input, context }) => {
			await requireConfigurationAccess(input.configurationId, context.orgId);
			const deleted = await secretFiles.deleteSecretFileByConfiguration(
				input.id,
				input.configurationId,
			);
			if (!deleted) {
				throw new ORPCError("NOT_FOUND", { message: "Secret file not found" });
			}
			return { deleted: true };
		}),

	/**
	 * Set a secret value (encrypts before storing).
	 */
	upsertSecret: orgProcedure
		.input(
			z.object({
				configurationId: z.string().uuid(),
				secretFileId: z.string().uuid(),
				key: z.string().min(1).max(200),
				value: z.string(),
				required: z.boolean().optional(),
			}),
		)
		.output(z.object({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await requireConfigurationAccess(input.configurationId, context.orgId);
			// Verify secretFileId belongs to this configuration
			const file = await secretFiles.findSecretFileByConfiguration(
				input.secretFileId,
				input.configurationId,
			);
			if (!file) {
				throw new ORPCError("NOT_FOUND", { message: "Secret file not found" });
			}
			const row = await secretFiles.upsertSecretValue({
				secretFileId: input.secretFileId,
				key: input.key,
				value: input.value,
				required: input.required,
			});
			return { id: row.id };
		}),

	/**
	 * Delete a configuration secret.
	 */
	deleteSecret: orgProcedure
		.input(z.object({ id: z.string().uuid(), configurationId: z.string().uuid() }))
		.output(z.object({ deleted: z.boolean() }))
		.handler(async ({ input, context }) => {
			await requireConfigurationAccess(input.configurationId, context.orgId);
			const deleted = await secretFiles.deleteSecretByConfiguration(
				input.id,
				input.configurationId,
			);
			if (!deleted) {
				throw new ORPCError("NOT_FOUND", { message: "Secret not found" });
			}
			return { deleted: true };
		}),
};
