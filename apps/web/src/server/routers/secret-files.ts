/**
 * Secret Files oRPC router.
 *
 * Thin transport layer: validates input, delegates to service, maps errors.
 */

import { logger } from "@/lib/infra/logger";
import { ORPCError } from "@orpc/server";
import { secretFiles } from "@proliferate/services";
import { SecretFileMetaSchema } from "@proliferate/shared/contracts/secrets";
import { z } from "zod";
import { orgProcedure } from "./middleware";

/** Re-export for callers that need the path normalizer. */
export const normalizeSecretFilePathForSandbox = secretFiles.normalizeSecretFilePath;

const log = logger.child({ handler: "secret-files" });

// ============================================
// Error Mapper
// ============================================

function throwMappedSecretFileError(err: unknown, fallbackMessage: string): never {
	if (err instanceof Error) {
		switch (err.name) {
			case "SecretFileForbiddenError":
				throw new ORPCError("FORBIDDEN", { message: err.message });
			case "SecretFileConfigurationNotFoundError":
			case "SecretFileNotFoundError":
				throw new ORPCError("NOT_FOUND", { message: err.message });
			case "SecretFilePathValidationError":
				throw new ORPCError("BAD_REQUEST", { message: err.message });
			case "SecretFileApplyError":
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: err.message });
		}
	}
	throw new ORPCError("INTERNAL_SERVER_ERROR", { message: fallbackMessage });
}

// ============================================
// Router
// ============================================

export const secretFilesRouter = {
	/**
	 * List secret files for a configuration (metadata only, no content).
	 */
	list: orgProcedure
		.input(z.object({ configurationId: z.string().uuid() }))
		.output(z.object({ files: z.array(SecretFileMetaSchema) }))
		.handler(async ({ input, context }) => {
			try {
				const rows = await secretFiles.listForConfiguration(context.orgId, input.configurationId);
				return {
					files: rows.map((r) => ({
						id: r.id,
						filePath: r.filePath,
						description: r.description,
						createdAt: r.createdAt?.toISOString() ?? null,
						updatedAt: r.updatedAt?.toISOString() ?? null,
					})),
				};
			} catch (err) {
				throwMappedSecretFileError(err, "Failed to list secret files");
			}
		}),

	/**
	 * Upsert a secret file. Encrypts content server-side before storing.
	 * Requires admin or owner role.
	 */
	upsert: orgProcedure
		.input(
			z.object({
				configurationId: z.string().uuid(),
				filePath: z.string().min(1).max(500),
				content: z.string(),
				description: z.string().max(500).optional(),
				sessionId: z.string().uuid().optional(),
			}),
		)
		.output(z.object({ file: SecretFileMetaSchema }))
		.handler(async ({ input, context }) => {
			try {
				const row = await secretFiles.upsertForOrg({
					organizationId: context.orgId,
					configurationId: input.configurationId,
					filePath: input.filePath,
					content: input.content,
					description: input.description,
					createdBy: context.user.id,
					userId: context.user.id,
				});

				// Optional live apply for active session UX (Environment panel path).
				if (input.sessionId) {
					try {
						await secretFiles.applyToActiveSession({
							orgId: context.orgId,
							sessionId: input.sessionId,
							configurationId: input.configurationId,
							filePath: input.filePath,
							content: input.content,
						});
					} catch (error) {
						// Best effort: the DB save succeeded even if runtime apply failed.
						log.warn(
							{
								err: error,
								orgId: context.orgId,
								configurationId: input.configurationId,
								sessionId: input.sessionId,
								filePath: input.filePath,
							},
							"Failed to live-apply secret file to active sandbox",
						);
					}
				}

				return {
					file: {
						id: row.id,
						filePath: row.filePath,
						description: row.description,
						createdAt: row.createdAt?.toISOString() ?? null,
						updatedAt: row.updatedAt?.toISOString() ?? null,
					},
				};
			} catch (err) {
				if (err instanceof ORPCError) throw err;
				throwMappedSecretFileError(err, "Failed to upsert secret file");
			}
		}),

	/**
	 * Delete a secret file.
	 * Requires admin or owner role.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			try {
				await secretFiles.deleteForOrg(input.id, context.orgId, context.user.id);
				return { success: true };
			} catch (err) {
				throwMappedSecretFileError(err, "Failed to delete secret file");
			}
		}),
};
