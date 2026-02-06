/**
 * OpenCodeClient
 *
 * Client for direct access to OpenCode via gateway proxy routes.
 * Used by CLI's `opencode --attach` command.
 */

import type { GatewayAuth } from "../../auth";
import { createTokenGetter } from "../../auth";
import { ExternalClientBase, type ExternalClientOptions } from "./base";

/**
 * Options for creating an OpenCodeClient
 */
export interface OpenCodeClientOptions extends ExternalClientOptions {}

/**
 * OpenCodeClient - passthrough to OpenCode server
 *
 * Provides URL for direct OpenCode access via gateway proxy.
 * Gateway handles auth and routing to the correct sandbox.
 */
export class OpenCodeClient extends ExternalClientBase {
	private auth: GatewayAuth;

	constructor(options: OpenCodeClientOptions) {
		super(options);
		this.auth = options.auth;
	}

	/**
	 * Get the passthrough URL for direct OpenCode access
	 *
	 * Returns URL in format: /proxy/:proliferateSessionId/:token/opencode
	 * Caller can append paths like /session, /events, etc.
	 */
	async getUrl(proliferateSessionId: string): Promise<string> {
		const token = await this.getToken();
		return `${this.baseUrl}/proxy/${proliferateSessionId}/${encodeURIComponent(token)}/opencode`;
	}
}

/**
 * Create an OpenCodeClient instance
 */
export function createOpenCodeClient(options: OpenCodeClientOptions): OpenCodeClient {
	return new OpenCodeClient(options);
}
