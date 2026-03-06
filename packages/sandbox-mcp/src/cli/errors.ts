export class CliError extends Error {
	public readonly exitCode: number;

	constructor(message: string, exitCode = 1) {
		super(message);
		this.name = "CliError";
		this.exitCode = exitCode;
	}
}

export function invariant(condition: unknown, message: string, exitCode = 2): asserts condition {
	if (!condition) {
		throw new CliError(message, exitCode);
	}
}
