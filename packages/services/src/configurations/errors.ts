/**
 * Configuration service error classes.
 */

export class ConfigurationNotFoundError extends Error {
	constructor(message = "Configuration not found") {
		super(message);
		this.name = "ConfigurationNotFoundError";
	}
}

export class ConfigurationForbiddenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigurationForbiddenError";
	}
}

export class ConfigurationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigurationValidationError";
	}
}

export class RepoNotInConfigurationError extends Error {
	constructor(message = "One or more repos not found") {
		super(message);
		this.name = "RepoNotInConfigurationError";
	}
}

export class SecretStorageError extends Error {
	constructor(key: string) {
		super(`Failed to store secret key: ${key}`);
		this.name = "SecretStorageError";
	}
}

export class ConfigurationRepoLinkError extends Error {
	constructor() {
		super("Failed to link repos to configuration");
		this.name = "ConfigurationRepoLinkError";
	}
}

export class SessionNotFoundError extends Error {
	constructor() {
		super("Session not found");
		this.name = "SessionNotFoundError";
	}
}

export class SetupSessionRequiredError extends Error {
	constructor() {
		super("Only setup sessions can be finalized");
		this.name = "SetupSessionRequiredError";
	}
}

export class NoSandboxError extends Error {
	constructor() {
		super("No sandbox associated with session");
		this.name = "NoSandboxError";
	}
}

export class RepoIdRequiredError extends Error {
	constructor(message?: string) {
		super(message ?? "repoId is required when session has no configuration");
		this.name = "RepoIdRequiredError";
	}
}

export class AmbiguousRepoError extends Error {
	constructor() {
		super("repoId required for multi-repo secret persistence");
		this.name = "AmbiguousRepoError";
	}
}

export class SnapshotFailedError extends Error {
	constructor(cause?: unknown) {
		super(`Failed to create snapshot: ${cause instanceof Error ? cause.message : "Unknown error"}`);
		this.name = "SnapshotFailedError";
	}
}

export class RepoNotFoundError extends Error {
	constructor() {
		super("Repo not found");
		this.name = "RepoNotFoundError";
	}
}

export class SessionRepoMismatchError extends Error {
	constructor() {
		super("Session not found for this repo");
		this.name = "SessionRepoMismatchError";
	}
}
