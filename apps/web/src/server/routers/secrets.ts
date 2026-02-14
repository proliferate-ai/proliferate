/**
 * Secrets oRPC router.
 *
 * Handles organization secrets CRUD operations.
 */

import { ORPCError } from "@orpc/server";
import { prebuilds, secretFiles, secrets } from "@proliferate/services";
import {
	BulkImportInputSchema,
	BulkImportResultSchema,
	CheckSecretsInputSchema,
	CheckSecretsResultSchema,
	CreateBundleInputSchema,
	CreateSecretInputSchema,
	SecretBundleSchema,
	SecretSchema,
	UpdateBundleInputSchema,
	UpdateSecretBundleInputSchema,
} from "@proliferate/shared";
import { z } from "zod";
import { orgProcedure } from "./middleware";

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
					bundleId: input.bundleId,
				});
				return { secret };
			} catch (err) {
				if (err instanceof secrets.DuplicateSecretError) {
					throw new ORPCError("CONFLICT", { message: err.message });
				}
				if (err instanceof secrets.EncryptionError) {
					throw new ORPCError("INTERNAL_SERVER_ERROR", { message: err.message });
				}
				if (err instanceof secrets.BundleOrgMismatchError) {
					throw new ORPCError("BAD_REQUEST", { message: err.message });
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
				prebuildId: input.prebuild_id,
			});
			return { keys: results };
		}),

	/**
	 * Update a secret's bundle assignment.
	 */
	updateBundle: orgProcedure
		.input(UpdateSecretBundleInputSchema)
		.output(z.object({ updated: z.boolean() }))
		.handler(async ({ input, context }) => {
			try {
				const updated = await secrets.updateSecretBundle(input.id, context.orgId, input.bundleId);
				return { updated };
			} catch (err) {
				if (err instanceof secrets.BundleOrgMismatchError) {
					throw new ORPCError("BAD_REQUEST", { message: err.message });
				}
				throw err;
			}
		}),

	// ============================================
	// Bundle operations
	// ============================================

	/**
	 * List all secret bundles for the current organization.
	 */
	listBundles: orgProcedure
		.input(z.object({}).optional())
		.output(z.object({ bundles: z.array(SecretBundleSchema) }))
		.handler(async ({ context }) => {
			const bundles = await secrets.listBundles(context.orgId);
			return { bundles };
		}),

	/**
	 * Create a new secret bundle.
	 */
	createBundle: orgProcedure
		.input(CreateBundleInputSchema)
		.output(z.object({ bundle: SecretBundleSchema }))
		.handler(async ({ input, context }) => {
			try {
				const bundle = await secrets.createBundle({
					organizationId: context.orgId,
					userId: context.user.id,
					name: input.name,
					description: input.description,
					targetPath: input.targetPath,
				});
				return { bundle };
			} catch (err) {
				if (err instanceof secrets.DuplicateBundleError) {
					throw new ORPCError("CONFLICT", { message: err.message });
				}
				if (err instanceof secrets.InvalidTargetPathError) {
					throw new ORPCError("BAD_REQUEST", { message: err.message });
				}
				throw err;
			}
		}),

	/**
	 * Update a secret bundle.
	 */
	updateBundleMeta: orgProcedure
		.input(z.object({ id: z.string().uuid() }).merge(UpdateBundleInputSchema))
		.output(z.object({ bundle: SecretBundleSchema }))
		.handler(async ({ input, context }) => {
			try {
				const bundle = await secrets.updateBundleMeta(input.id, context.orgId, {
					name: input.name,
					description: input.description,
					targetPath: input.targetPath,
				});
				return { bundle };
			} catch (err) {
				if (err instanceof secrets.BundleNotFoundError) {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				if (err instanceof secrets.DuplicateBundleError) {
					throw new ORPCError("CONFLICT", { message: err.message });
				}
				if (err instanceof secrets.InvalidTargetPathError) {
					throw new ORPCError("BAD_REQUEST", { message: err.message });
				}
				throw err;
			}
		}),

	/**
	 * Delete a secret bundle. Secrets become unbundled.
	 */
	deleteBundle: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ deleted: z.boolean() }))
		.handler(async ({ input, context }) => {
			await secrets.deleteBundle(input.id, context.orgId);
			return { deleted: true };
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
					bundleId: input.bundleId,
				});
			} catch (err) {
				if (err instanceof secrets.EncryptionError) {
					throw new ORPCError("INTERNAL_SERVER_ERROR", { message: err.message });
				}
				if (err instanceof secrets.BundleOrgMismatchError) {
					throw new ORPCError("BAD_REQUEST", { message: err.message });
				}
				throw err;
			}
		}),
};

// ============================================
// Secret Files Router (PR1 expand — config-scoped env files)
// ============================================

const SecretFileKeySchema = z.object({
	id: z.string().uuid(),
	key: z.string(),
	hasValue: z.boolean(),
	required: z.boolean(),
});

const SecretFileSchema = z.object({
	id: z.string().uuid(),
	prebuildId: z.string().uuid(),
	workspacePath: z.string(),
	filePath: z.string(),
	mode: z.string(),
	keys: z.array(SecretFileKeySchema),
});

/** Verify the prebuild belongs to the caller's org. */
async function requirePrebuildAccess(prebuildId: string, orgId: string) {
	const prebuild = await prebuilds.findById(prebuildId);
	if (!prebuild) {
		throw new ORPCError("NOT_FOUND", { message: "Prebuild not found" });
	}
	const prebuildOrgId = prebuild.prebuildRepos?.[0]?.repo?.organizationId;
	if (prebuildOrgId !== orgId) {
		throw new ORPCError("NOT_FOUND", { message: "Prebuild not found" });
	}
}

export const secretFilesRouter = {
	/**
	 * List secret files for a prebuild with their keys.
	 */
	list: orgProcedure
		.input(z.object({ prebuildId: z.string().uuid() }))
		.output(z.object({ files: z.array(SecretFileSchema) }))
		.handler(async ({ input, context }) => {
			await requirePrebuildAccess(input.prebuildId, context.orgId);
			const rows = await secretFiles.listSecretFiles(input.prebuildId);
			const files = rows.map((r) => ({
				id: r.id,
				prebuildId: r.prebuildId,
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
				prebuildId: z.string().uuid(),
				filePath: z.string().min(1).max(500),
				workspacePath: z.string().max(500).default("."),
				mode: z.enum(["secret"]).default("secret"),
			}),
		)
		.output(z.object({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await requirePrebuildAccess(input.prebuildId, context.orgId);
			const file = await secretFiles.createSecretFile({
				prebuildId: input.prebuildId,
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
		.input(z.object({ id: z.string().uuid(), prebuildId: z.string().uuid() }))
		.output(z.object({ deleted: z.boolean() }))
		.handler(async ({ input, context }) => {
			await requirePrebuildAccess(input.prebuildId, context.orgId);
			await secretFiles.deleteSecretFile(input.id);
			return { deleted: true };
		}),

	/**
	 * Set a secret value (encrypts before storing).
	 */
	upsertSecret: orgProcedure
		.input(
			z.object({
				prebuildId: z.string().uuid(),
				secretFileId: z.string().uuid(),
				key: z.string().min(1).max(200),
				value: z.string(),
				required: z.boolean().optional(),
			}),
		)
		.output(z.object({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await requirePrebuildAccess(input.prebuildId, context.orgId);
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
		.input(z.object({ id: z.string().uuid(), prebuildId: z.string().uuid() }))
		.output(z.object({ deleted: z.boolean() }))
		.handler(async ({ input, context }) => {
			await requirePrebuildAccess(input.prebuildId, context.orgId);
			await secretFiles.deleteSecret(input.id);
			return { deleted: true };
		}),
};
