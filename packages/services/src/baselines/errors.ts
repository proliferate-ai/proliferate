/**
 * Baselines error classes.
 *
 * Domain errors thrown by the baselines service for resolution, target, and status-machine failures.
 */

export class BaselineNotFoundError extends Error {
	constructor(repoId: string) {
		super(
			`No active baseline found for repo ${repoId}. Run setup to create a validated baseline before starting task sessions.`,
		);
		this.name = "BaselineNotFoundError";
	}
}

export class BaselineTargetNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BaselineTargetNotFoundError";
	}
}

export class BaselineTargetMismatchError extends Error {
	constructor(targetId: string, baselineId: string) {
		super(`Target ${targetId} does not belong to baseline ${baselineId}`);
		this.name = "BaselineTargetMismatchError";
	}
}

export class BaselineNoTargetsError extends Error {
	constructor(baselineId: string) {
		super(
			`Baseline ${baselineId} has no targets. At least one target must be created during setup.`,
		);
		this.name = "BaselineNoTargetsError";
	}
}

export class BaselineInvalidTransitionError extends Error {
	constructor(fromStatus: string, toStatus: string) {
		super(`Invalid baseline transition: ${fromStatus} → ${toStatus}`);
		this.name = "BaselineInvalidTransitionError";
	}
}

export class BaselineTransitionConflictError extends Error {
	constructor(baselineId: string, expectedStatus: string) {
		super(
			`Baseline ${baselineId} transition failed — ` +
				`expected status ${expectedStatus} but current status differs (CAS conflict)`,
		);
		this.name = "BaselineTransitionConflictError";
	}
}
