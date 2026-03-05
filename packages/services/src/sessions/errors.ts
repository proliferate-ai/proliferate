/**
 * Session error classes.
 *
 * Centralised so every file in the sessions module (and external consumers)
 * can import from a single location without circular dependencies.
 */

// ============================================
// Session creation errors
// ============================================

export class SessionLimitError extends Error {
	constructor(public maxSessions: number) {
		super(
			`Concurrent session limit reached. Your plan allows ${maxSessions} concurrent session${maxSessions === 1 ? "" : "s"}.`,
		);
		this.name = "SessionLimitError";
	}
}

export class ConfigurationNotFoundError extends Error {
	constructor() {
		super("Configuration not found");
		this.name = "ConfigurationNotFoundError";
	}
}

export class ConfigurationNoReposError extends Error {
	constructor() {
		super("Configuration has no repos");
		this.name = "ConfigurationNoReposError";
	}
}

export class ConfigurationRepoUnauthorizedError extends Error {
	constructor() {
		super("Unauthorized access to configuration repos");
		this.name = "ConfigurationRepoUnauthorizedError";
	}
}

// ============================================
// V1 session errors
// ============================================

export class SessionNotFoundError extends Error {
	constructor(sessionId: string) {
		super(`Session not found: ${sessionId}`);
	}
}

export class SessionKindError extends Error {
	constructor(expected: string, actual: string | null | undefined) {
		super(`Invalid session kind: expected ${expected}, received ${actual ?? "null"}`);
	}
}

export class SessionRuntimeStatusError extends Error {}

export class SessionAccessDeniedError extends Error {
	constructor(sessionId: string) {
		super(`Access denied to session: ${sessionId}`);
		this.name = "SessionAccessDeniedError";
	}
}

// ============================================
// Task session errors
// ============================================

export class TaskSessionValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TaskSessionValidationError";
	}
}

// ============================================
// Pause / snapshot errors
// ============================================

export class SessionInvalidStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionInvalidStateError";
	}
}

export class SessionSnapshotQuotaError extends Error {
	constructor() {
		super("Snapshot quota exceeded. Delete an existing snapshot and try again.");
		this.name = "SessionSnapshotQuotaError";
	}
}
