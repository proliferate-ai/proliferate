/**
 * ExternalClient Base
 *
 * Base class for wrapping external systems (OpenCode, etc.)
 */

import type { GatewayAuth, TokenGetter } from "../../auth";
import { createTokenGetter } from "../../auth";
import { createVerificationTools } from "../../capabilities/tools";
import type { Client, ClientTools } from "../../client";
import type { HealthCheckResult, HttpClient } from "../../types";
import { checkHealth, createHttpClient } from "../sync/http";

/**
 * Options for creating an ExternalClient
 */
export interface ExternalClientOptions {
	/** Base URL of the gateway (e.g., "https://gateway.example.com") */
	baseUrl: string;
	/** Auth configuration - either service auth (JWT signing) or user token */
	auth: GatewayAuth;
}

/**
 * ExternalClient interface - for wrapping external systems
 */
export interface ExternalClient extends Client {
	readonly type: "external";

	/**
	 * Get the passthrough URL for direct access to the external system
	 */
	getUrl(proliferateSessionId: string): Promise<string>;
}

/**
 * Base implementation of ExternalClient
 *
 * Subclasses implement getUrl() to return the appropriate passthrough URL.
 */
export abstract class ExternalClientBase implements ExternalClient {
	readonly type = "external" as const;
	readonly tools: ClientTools;

	protected baseUrl: string;
	protected getToken: TokenGetter;
	protected http: HttpClient;

	constructor(options: ExternalClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/$/, "");
		this.getToken = createTokenGetter(options.auth);
		this.http = createHttpClient(this.baseUrl, this.getToken);

		// Attach capabilities
		this.tools = {
			verification: createVerificationTools(this.http),
		};
	}

	async checkHealth(): Promise<HealthCheckResult> {
		return checkHealth(this.http);
	}

	/**
	 * Get the passthrough URL for direct access to the external system
	 */
	abstract getUrl(proliferateSessionId: string): Promise<string>;
}
