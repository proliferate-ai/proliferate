/**
 * Secrets oRPC router.
 *
 * Handles organization secrets CRUD operations.
 */

import { ORPCError } from "@orpc/server";
import { secrets } from "@proliferate/services";
import {
	BulkImportInputSchema,
	BulkImportResultSchema,
	CheckSecretsInputSchema,
	CheckSecretsResultSchema,
	CreateSecretInputSchema,
	SecretSchema,
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
					configurationId: input.configurationId,
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
