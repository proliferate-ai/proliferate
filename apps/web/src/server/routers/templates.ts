/**
 * Templates oRPC router.
 *
 * Read-only endpoint for serving the automation template catalog.
 */

import { templates } from "@proliferate/services";
import { z } from "zod";
import { orgProcedure } from "./middleware";

const IntegrationRequirementSchema = z.object({
	provider: z.string(),
	reason: z.string(),
	required: z.boolean(),
});

const TemplateTriggerSchema = z.object({
	provider: z.string(),
	triggerType: z.string(),
	config: z.record(z.unknown()),
	cronExpression: z.string().optional(),
});

const AutomationTemplateSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	longDescription: z.string().optional(),
	icon: z.string(),
	category: z.string(),
	agentInstructions: z.string(),
	modelId: z.string().optional(),
	triggers: z.array(TemplateTriggerSchema),
	enabledTools: z.record(z.unknown()),
	actionModes: z.record(z.enum(["allow", "require_approval", "deny"])).optional(),
	requiredIntegrations: z.array(IntegrationRequirementSchema),
	requiresRepo: z.boolean(),
});

export const templatesRouter = {
	/**
	 * List all available automation templates.
	 */
	list: orgProcedure
		.output(z.object({ templates: z.array(AutomationTemplateSchema) }))
		.handler(async () => {
			return {
				templates: templates.TEMPLATE_CATALOG.map((t) => ({
					...t,
					enabledTools: t.enabledTools as Record<string, unknown>,
				})),
			};
		}),
};
