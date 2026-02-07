/**
 * Prebuilds oRPC router.
 *
 * Handles prebuild CRUD operations.
 */

import { logger } from "@/lib/logger";
import { ORPCError } from "@orpc/server";
import { prebuilds } from "@proliferate/services";
import {
	CreatePrebuildInputSchema,
	PrebuildSchema,
	UpdatePrebuildInputSchema,
} from "@proliferate/shared";
import { z } from "zod";
import { orgProcedure } from "./middleware";

const log = logger.child({ handler: "prebuilds" });

export const prebuildsRouter = {
	/**
	 * List prebuilds for the current organization.
	 */
	list: orgProcedure
		.input(z.object({ status: z.string().optional() }).optional())
		.output(z.object({ prebuilds: z.array(PrebuildSchema) }))
		.handler(async ({ input, context }) => {
			const prebuildsList = await prebuilds.listPrebuilds(context.orgId, input?.status);
			return { prebuilds: prebuildsList };
		}),

	/**
	 * Create a new prebuild.
	 */
	create: orgProcedure
		.input(CreatePrebuildInputSchema)
		.output(z.object({ prebuildId: z.string().uuid(), repos: z.number() }))
		.handler(async ({ input, context }) => {
			// Support both new repoIds[] and legacy repos[] format
			const repoIds = input.repoIds || input.repos?.map((r) => r.repoId);

			if (!repoIds || repoIds.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "repoIds[] is required",
				});
			}

			try {
				const result = await prebuilds.createPrebuild({
					organizationId: context.orgId,
					userId: context.user.id,
					repoIds,
					name: input.name,
				});

				return {
					prebuildId: result.prebuildId,
					repos: result.repoCount,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to create prebuild";

				if (message === "One or more repos not found") {
					throw new ORPCError("NOT_FOUND", { message });
				}
				if (message === "Unauthorized access to repo") {
					throw new ORPCError("FORBIDDEN", { message });
				}
				if (message === "repoIds[] is required") {
					throw new ORPCError("BAD_REQUEST", { message });
				}

				log.error({ err: error }, "Failed to create prebuild");
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message });
			}
		}),

	/**
	 * Update a prebuild.
	 */
	update: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				...UpdatePrebuildInputSchema.shape,
			}),
		)
		.output(z.object({ prebuild: PrebuildSchema }))
		.handler(async ({ input, context }) => {
			const { id, name, notes } = input;

			// Verify the prebuild exists and belongs to this org
			const belongsToOrg = await prebuilds.prebuildBelongsToOrg(id, context.orgId);
			if (!belongsToOrg) {
				throw new ORPCError("NOT_FOUND", { message: "Prebuild not found" });
			}

			try {
				const updated = await prebuilds.updatePrebuild(id, { name, notes });

				return {
					prebuild: {
						id: updated.id!,
						snapshotId: updated.snapshotId ?? null,
						status: updated.status ?? null,
						name: updated.name ?? null,
						notes: updated.notes ?? null,
						createdAt: updated.createdAt?.toISOString() ?? null,
						createdBy: updated.createdBy ?? null,
						sandboxProvider: updated.sandboxProvider ?? null,
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to update prebuild";

				if (message === "No fields to update") {
					throw new ORPCError("BAD_REQUEST", { message });
				}

				log.error({ err: error }, "Failed to update prebuild");
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message });
			}
		}),

	/**
	 * Delete a prebuild.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			// Verify the prebuild belongs to this org
			const belongsToOrg = await prebuilds.prebuildBelongsToOrg(input.id, context.orgId);
			if (!belongsToOrg) {
				throw new ORPCError("NOT_FOUND", { message: "Prebuild not found" });
			}

			try {
				await prebuilds.deletePrebuild(input.id);
				return { success: true };
			} catch (error) {
				log.error({ err: error }, "Failed to delete prebuild");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to delete prebuild",
				});
			}
		}),
};
