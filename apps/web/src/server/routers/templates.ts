/**
 * Templates oRPC router.
 *
 * Read-only endpoint for serving the automation template catalog.
 */

import { templates } from "@proliferate/services";
import { AutomationTemplateSchema } from "@proliferate/shared/contracts/templates";
import { z } from "zod";
import { orgProcedure } from "./middleware";

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
