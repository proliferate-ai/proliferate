/**
 * User action preferences oRPC router.
 *
 * Per-user, per-org toggles for action sources (integrations + connectors).
 * Users can enable/disable which tools appear in their coding sessions.
 */

import { isOrgActionDenied } from "@/lib/integrations/action-permissions";
import { ORPCError } from "@orpc/server";
import { orgs, userActionPreferences } from "@proliferate/services";
import { z } from "zod";
import { orgProcedure } from "./middleware";

const UserActionPreferenceSchema = z.object({
	id: z.string(),
	userId: z.string(),
	organizationId: z.string(),
	sourceId: z.string(),
	actionId: z.string().nullable(),
	enabled: z.boolean(),
	createdAt: z.coerce.date().nullable(),
	updatedAt: z.coerce.date().nullable(),
});

export const userActionPreferencesRouter = {
	/**
	 * List all preferences for the current user + org.
	 */
	list: orgProcedure
		.input(z.object({}).optional())
		.output(z.object({ preferences: z.array(UserActionPreferenceSchema) }))
		.handler(async ({ context }) => {
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
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			if (input.actionId) {
				if (input.enabled) {
					const actionModes = await orgs.getActionModes(context.orgId);
					const actionModeKey = `${input.sourceId}:${input.actionId}`;
					if (isOrgActionDenied(actionModes, actionModeKey)) {
						throw new ORPCError("FORBIDDEN", {
							message: "Action is disabled by organization policy",
							data: {
								code: "ACTION_DENIED_BY_ORG_POLICY",
								key: actionModeKey,
							},
						});
					}
				}
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
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			await userActionPreferences.bulkSetPreferences(
				context.user.id,
				context.orgId,
				input.preferences,
			);
			return { success: true };
		}),
};
