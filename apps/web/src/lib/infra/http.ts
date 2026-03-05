export class HttpError extends Error {
	status: number;
	statusText: string;

	constructor(status: number, statusText: string, message?: string) {
		super(message ?? `HTTP ${status}: ${statusText}`);
		this.name = "HttpError";
		this.status = status;
		this.statusText = statusText;
	}
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
	if (!response.ok) {
		throw new HttpError(response.status, response.statusText);
	}
	return response.json() as Promise<T>;
}
