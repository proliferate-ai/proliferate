/**
 * Integration error classes.
 *
 * Domain-specific errors thrown by the integrations service layer.
 */

export class OrganizationNotFoundError extends Error {
	constructor(message = "Organization not found") {
		super(message);
		this.name = "OrganizationNotFoundError";
	}
}

export class IntegrationAccessDeniedError extends Error {
	constructor(message = "Access denied") {
		super(message);
		this.name = "IntegrationAccessDeniedError";
	}
}

export class IntegrationNotFoundError extends Error {
	constructor(id?: string) {
		super(id ? `Integration ${id} not found` : "Integration not found");
		this.name = "IntegrationNotFoundError";
	}
}

export class IntegrationInactiveError extends Error {
	constructor() {
		super("Integration is not active");
		this.name = "IntegrationInactiveError";
	}
}

export class IntegrationAdminRequiredError extends Error {
	constructor() {
		super("Admin or owner role required");
		this.name = "IntegrationAdminRequiredError";
	}
}

export class NoAccessTokenError extends Error {
	constructor() {
		super("No access token available");
		this.name = "NoAccessTokenError";
	}
}

export class SlackConfigValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SlackConfigValidationError";
	}
}
