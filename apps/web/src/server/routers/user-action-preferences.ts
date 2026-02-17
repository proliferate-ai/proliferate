/**
 * User action preferences oRPC router.
 *
 * Per-user, per-org toggles for action sources (integrations + connectors).
 * Users can enable/disable which tools appear in their coding sessions.
 */

import { userActionPreferences } from "@proliferate/services";
import { z } from "zod";
import { orgProcedure } from "./middleware";

export const userActionPreferencesRouter = {
	/**
	 * List all preferences for the current user + org.
	 */
	list: orgProcedure.handler(async ({ context }) => {
		const prefs = await userActionPreferences.listPreferences(context.user.id, context.orgId);
		return { preferences: prefs };
	}),

	/**
	 * Toggle a single source or action.
	 */
	update: orgProcedure
		.input(
			z.object({
				sourceId: z.string().min(1),
				actionId: z.string().min(1).nullable().optional(),
				enabled: z.boolean(),
			}),
		)
		.handler(async ({ input, context }) => {
			if (input.actionId) {
				await userActionPreferences.setActionEnabled(
					context.user.id,
					context.orgId,
					input.sourceId,
					input.actionId,
					input.enabled,
				);
			} else {
				await userActionPreferences.setSourceEnabled(
					context.user.id,
					context.orgId,
					input.sourceId,
					input.enabled,
				);
			}
			return { success: true };
		}),

	/**
	 * Bulk toggle sources (for onboarding / batch operations).
	 */
	bulkUpdate: orgProcedure
		.input(
			z.object({
				preferences: z.array(
					z.object({
						sourceId: z.string().min(1),
						enabled: z.boolean(),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			await userActionPreferences.bulkSetPreferences(
				context.user.id,
				context.orgId,
				input.preferences,
			);
			return { success: true };
		}),
};
