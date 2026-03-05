/**
 * Custom error classes for the automations module.
 */

// ============================================
// Automation errors (from service.ts)
// ============================================

export class AutomationNotFoundError extends Error {
	constructor(message = "Automation not found") {
		super(message);
		this.name = "AutomationNotFoundError";
	}
}

export class AutomationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AutomationValidationError";
	}
}

export class AutomationIntegrationNotFoundError extends Error {
	constructor(message = "Integration not found") {
		super(message);
		this.name = "AutomationIntegrationNotFoundError";
	}
}

// ============================================
// Template errors (from create-from-template.ts)
// ============================================

export class TemplateNotFoundError extends Error {
	constructor(templateId: string) {
		super(`Template not found: ${templateId}`);
		this.name = "TemplateNotFoundError";
	}
}

export class TemplateIntegrationNotFoundError extends Error {
	constructor(integrationId: string) {
		super(`Integration ${integrationId} not found in organization`);
		this.name = "TemplateIntegrationNotFoundError";
	}
}

export class TemplateIntegrationInactiveError extends Error {
	constructor(integrationId: string, status: string | null) {
		super(`Integration ${integrationId} is not active (status: ${status})`);
		this.name = "TemplateIntegrationInactiveError";
	}
}

export class TemplateIntegrationBindingMismatchError extends Error {
	constructor(integrationId: string, actualBinding: string, expectedBinding: string) {
		super(`Integration ${integrationId} is for "${actualBinding}", not "${expectedBinding}"`);
		this.name = "TemplateIntegrationBindingMismatchError";
	}
}
