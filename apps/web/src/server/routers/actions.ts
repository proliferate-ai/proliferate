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
		.handler(async ({ input, context }) => {
			const limit = input?.limit ?? 50;
			const offset = input?.offset ?? 0;
			const result = await actions.listOrgActions(context.orgId, {
				status: input?.status,
				limit,
				offset,
			});
			return {
				invocations: result.invocations.map(serializeInvocation),
				total: result.total,
				limit,
				offset,
			};
		}),
};

/** Serialize dates to ISO strings for transport. */
function serializeInvocation(row: actions.ActionInvocationWithSession) {
	return {
		...row,
		approvedAt: row.approvedAt?.toISOString() ?? null,
		completedAt: row.completedAt?.toISOString() ?? null,
		expiresAt: row.expiresAt?.toISOString() ?? null,
		createdAt: row.createdAt?.toISOString() ?? null,
	};
}
