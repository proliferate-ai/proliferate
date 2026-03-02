/**
 * CLI Exit Codes
 *
 * Maps error classes to differentiated exit codes per spec contract.
 */

export const ExitCode = {
	/** Command succeeded */
	Success: 0,
	/** Invalid arguments or request body */
	Validation: 2,
	/** Policy denied the operation */
	PolicyDenied: 3,
	/** Action requires approval (pending_approval) */
	ApprovalRequired: 4,
	/** Transient failure, safe to retry */
	Retryable: 5,
	/** Terminal failure, do not retry */
	Terminal: 6,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Typed CLI error that carries an exit code and optional error code.
 */
export class CliError extends Error {
	constructor(
		message: string,
		public readonly exitCode: ExitCodeValue,
		public readonly code?: string,
	) {
		super(message);
		this.name = "CliError";
	}
}

/**
 * Map HTTP status codes to CLI exit codes.
 */
export function mapHttpStatusToExitCode(status: number): ExitCodeValue {
	if (status >= 200 && status < 300 && status !== 202) return ExitCode.Success;
	if (status === 202) return ExitCode.ApprovalRequired;
	if (status === 400 || status === 422) return ExitCode.Validation;
	if (status === 401) return ExitCode.Terminal;
	if (status === 403) return ExitCode.PolicyDenied;
	if (status === 429 || status === 503) return ExitCode.Retryable;
	if (status >= 500) return ExitCode.Retryable;
	return ExitCode.Terminal;
}
