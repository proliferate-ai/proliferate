/**
 * Actions error classes.
 *
 * Domain errors thrown by the actions service layer.
 */

export class ActionNotFoundError extends Error {
	constructor(message = "Invocation not found") {
		super(message);
		this.name = "ActionNotFoundError";
	}
}

export class ActionExpiredError extends Error {
	constructor(message = "Invocation has expired") {
		super(message);
		this.name = "ActionExpiredError";
	}
}

export class ActionConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ActionConflictError";
	}
}

export class PendingLimitError extends Error {
	constructor(message = "Too many pending approvals. Resolve existing ones first.") {
		super(message);
		this.name = "PendingLimitError";
	}
}

export class ApprovalAuthorityError extends Error {
	constructor(message = "You do not have approval authority for this session") {
		super(message);
		this.name = "ApprovalAuthorityError";
	}
}
