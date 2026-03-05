/**
 * Custom error classes for the triggers service.
 */

export class TriggerEventNotQueueableError extends Error {
	constructor(status: string) {
		super(`Event is already ${status}`);
		this.name = "TriggerEventNotQueueableError";
	}
}

export class TriggerConfigurationNotFoundError extends Error {
	constructor() {
		super("Configuration not found");
		this.name = "TriggerConfigurationNotFoundError";
	}
}

export class TriggerIntegrationNotFoundError extends Error {
	constructor() {
		super("Integration not found");
		this.name = "TriggerIntegrationNotFoundError";
	}
}

export class TriggerServiceUnavailableError extends Error {
	constructor(message = "Trigger service not configured") {
		super(message);
		this.name = "TriggerServiceUnavailableError";
	}
}
