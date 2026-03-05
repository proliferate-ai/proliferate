/**
 * API error with status code and optional details.
 */
export class ApiError extends Error {
	constructor(
		public readonly statusCode: number,
		message: string,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}
