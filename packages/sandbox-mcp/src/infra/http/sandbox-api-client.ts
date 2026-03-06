import { CliError } from "../../cli/errors.js";
import { sandboxEnv } from "../../env.js";
import { fetchWithRetry, streamSse } from "./sse-client.js";

export class SandboxApiClient {
	private readonly baseUrl = sandboxEnv.baseUrl;
	private readonly authToken = sandboxEnv.authToken;

	private getHeaders(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.authToken}`,
			"Content-Type": "application/json",
		};
	}

	assertAuthToken(): void {
		if (!this.authToken) {
			throw new CliError(
				"Auth token not set. Set SANDBOX_MCP_AUTH_TOKEN or SERVICE_TO_SERVICE_AUTH_TOKEN.",
				2,
			);
		}
	}

	async request(method: string, path: string, body?: Record<string, unknown>): Promise<unknown> {
		this.assertAuthToken();
		const response = await fetchWithRetry(`${this.baseUrl}${path}`, {
			method,
			headers: this.getHeaders(),
			body: body ? JSON.stringify(body) : undefined,
		});
		const payload = await response.json();
		if (!response.ok) {
			const message =
				typeof payload === "object" && payload !== null && "error" in payload
					? (payload as { error: string }).error
					: `HTTP ${response.status}`;
			throw new Error(message);
		}
		return payload;
	}

	async streamLogs(path: string, follow: boolean): Promise<void> {
		this.assertAuthToken();
		await streamSse(`${this.baseUrl}${path}`, {
			authToken: this.authToken as string,
			follow,
			onData: (payload) => {
				process.stdout.write(`${payload}\n`);
			},
		});
	}
}
