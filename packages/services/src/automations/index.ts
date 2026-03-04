/**
 * Automations module exports.
 */

export * from "./service";
export {
	createFromTemplate,
	type CreateFromTemplateInput,
	TemplateNotFoundError,
	TemplateIntegrationNotFoundError,
	TemplateIntegrationInactiveError,
	TemplateIntegrationBindingMismatchError,
} from "./create-from-template";
