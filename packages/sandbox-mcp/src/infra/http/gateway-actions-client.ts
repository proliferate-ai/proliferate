import { CliError } from "../../cli/errors.js";
import { sandboxEnv } from "../../env.js";

const ACTIONS_TIMEOUT_MS = 120_000;

export interface GatewayResult {
	status: number;
	data: unknown;
}

export class GatewayActionsClient {
	private readonly gatewayUrl = sandboxEnv.gatewayUrl;
	private readonly sessionId = sandboxEnv.sessionId;
	private readonly authToken = sandboxEnv.authToken;

	private getUrl(path: string): string {
		if (!this.gatewayUrl || !this.sessionId) {
			throw new Error("Actions require PROLIFERATE_GATEWAY_URL and PROLIFERATE_SESSION_ID");
		}
		return `${this.gatewayUrl}/proliferate/${this.sessionId}/actions${path}`;
	}

	private getHeaders(): Record<string, string> {
		if (!this.authToken) {
			throw new CliError("Auth token not set. Set SANDBOX_MCP_AUTH_TOKEN.", 2);
		}
		return {
			Authorization: `Bearer ${this.authToken}`,
			"Content-Type": "application/json",
		};
	}

	async request(
		method: string,
		path: string,
		body?: Record<string, unknown>,
	): Promise<GatewayResult> {
		const response = await fetch(this.getUrl(path), {
			method,
			headers: this.getHeaders(),
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(ACTIONS_TIMEOUT_MS),
		});
		return { status: response.status, data: await response.json() };
	}
}
