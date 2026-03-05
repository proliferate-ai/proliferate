/**
 * Secret Files domain errors.
 */

export class SecretFileForbiddenError extends Error {
	constructor(message = "Only admins and owners can manage secret files") {
		super(message);
		this.name = "SecretFileForbiddenError";
	}
}

export class SecretFileConfigurationNotFoundError extends Error {
	constructor(message = "Configuration not found") {
		super(message);
		this.name = "SecretFileConfigurationNotFoundError";
	}
}

export class SecretFileNotFoundError extends Error {
	constructor(message = "Secret file not found") {
		super(message);
		this.name = "SecretFileNotFoundError";
	}
}

export class SecretFilePathValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SecretFilePathValidationError";
	}
}

export class SecretFileApplyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SecretFileApplyError";
	}
}
