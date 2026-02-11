/**
 * Secrets oRPC router.
 *
 * Handles organization secrets CRUD operations.
 */

import { ORPCError } from "@orpc/server";
import { secrets } from "@proliferate/services";
import {
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
				});
				return { bundle };
			} catch (err) {
				if (err instanceof secrets.DuplicateBundleError) {
					throw new ORPCError("CONFLICT", { message: err.message });
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
				});
				return { bundle };
			} catch (err) {
				if (err instanceof secrets.BundleNotFoundError) {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				if (err instanceof secrets.DuplicateBundleError) {
					throw new ORPCError("CONFLICT", { message: err.message });
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
};
