/**
 * Secret Files oRPC router.
 *
 * Handles file-based secrets CRUD for configurations.
 * Write operations require admin/owner role.
 */

import { ORPCError } from "@orpc/server";
import { configurations, orgs, secretFiles } from "@proliferate/services";
import { z } from "zod";
import { orgProcedure } from "./middleware";

const SecretFileMetaSchema = z.object({
	id: z.string().uuid(),
	filePath: z.string(),
	description: z.string().nullable(),
	createdAt: z.string().nullable(),
	updatedAt: z.string().nullable(),
});

export const secretFilesRouter = {
	/**
	 * List secret files for a configuration (metadata only, no content).
	 */
	list: orgProcedure
		.input(z.object({ configurationId: z.string().uuid() }))
		.output(z.object({ files: z.array(SecretFileMetaSchema) }))
		.handler(async ({ input, context }) => {
			const rows = await secretFiles.listByConfiguration(context.orgId, input.configurationId);
			return {
				files: rows.map((r) => ({
					id: r.id,
					filePath: r.filePath,
					description: r.description,
					createdAt: r.createdAt?.toISOString() ?? null,
					updatedAt: r.updatedAt?.toISOString() ?? null,
				})),
			};
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
			}),
		)
		.output(z.object({ file: SecretFileMetaSchema }))
		.handler(async ({ input, context }) => {
			const role = await orgs.getUserRole(context.user.id, context.orgId);
			if (role !== "owner" && role !== "admin") {
				throw new ORPCError("FORBIDDEN", {
					message: "Only admins and owners can manage secret files",
				});
			}
			const belongsToOrg = await configurations.configurationBelongsToOrg(
				input.configurationId,
				context.orgId,
			);
			if (!belongsToOrg) {
				// Config ownership is inferred via linked repos. Empty configurations can
				// legitimately have no repo links, so fall back to existence check.
				const exists = await configurations.configurationExists(input.configurationId);
				if (!exists) {
					throw new ORPCError("NOT_FOUND", { message: "Configuration not found" });
				}
			}

			const row = await secretFiles.upsertSecretFile({
				organizationId: context.orgId,
				configurationId: input.configurationId,
				filePath: input.filePath,
				content: input.content,
				description: input.description,
				createdBy: context.user.id,
			});

			return {
				file: {
					id: row.id,
					filePath: row.filePath,
					description: row.description,
					createdAt: row.createdAt?.toISOString() ?? null,
					updatedAt: row.updatedAt?.toISOString() ?? null,
				},
			};
		}),

	/**
	 * Delete a secret file.
	 * Requires admin or owner role.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			const role = await orgs.getUserRole(context.user.id, context.orgId);
			if (role !== "owner" && role !== "admin") {
				throw new ORPCError("FORBIDDEN", {
					message: "Only admins and owners can manage secret files",
				});
			}

			const deleted = await secretFiles.deleteById(input.id, context.orgId);
			if (!deleted) {
				throw new ORPCError("NOT_FOUND", { message: "Secret file not found" });
			}

			return { success: true };
		}),
};
