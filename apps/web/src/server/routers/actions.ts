/**
 * Actions oRPC router.
 *
 * Org-level action invocation queries for the dashboard approvals inbox.
 * Approve/deny goes through Gateway HTTP (not oRPC) to reuse execution logic.
 */

import { actions } from "@proliferate/services";
import { z } from "zod";
import { orgProcedure } from "./middleware";

export const actionsRouter = {
	/**
	 * List action invocations for the current org.
	 * Supports filtering by status and pagination.
	 */
	list: orgProcedure
		.input(
			z
				.object({
					status: z.string().optional(),
					limit: z.number().int().positive().max(100).optional(),
					offset: z.number().int().nonnegative().optional(),
				})
				.optional(),
		)
		.output(
			z.object({
				invocations: z.array(z.any()),
				total: z.number(),
				limit: z.number(),
				offset: z.number(),
			}),
		)
		.handler(async ({ input, context }) => {
			const limit = input?.limit ?? 50;
			const offset = input?.offset ?? 0;
			const result = await actions.listOrgActionsForTransport(context.orgId, {
				status: input?.status,
				limit,
				offset,
			});
			return {
				invocations: result.invocations,
				total: result.total,
				limit,
				offset,
			};
		}),
};
