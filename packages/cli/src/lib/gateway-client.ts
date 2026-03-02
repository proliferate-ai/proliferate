/**
 * Gateway HTTP Client
 *
 * Authenticated client for CLI commands running inside a sandbox.
 * Reads PROLIFERATE_SESSION_TOKEN + PROLIFERATE_GATEWAY_URL from env.
 * On 401, retries once with a re-read of the token from env.
 */

import { type CliEnvelope, errorEnvelope, successEnvelope } from "./envelope.ts";
import { CliError, ExitCode, type ExitCodeValue, mapHttpStatusToExitCode } from "./exit-codes.ts";

/**
 * Read the session token from env. Called at request time, not module load,
 * so daemon-mediated refresh (Phase B) can update it between calls.
 */
export function getSessionToken(): string {
	const token = process.env.PROLIFERATE_SESSION_TOKEN;
	if (!token) {
		throw new CliError("PROLIFERATE_SESSION_TOKEN not set", ExitCode.Terminal, "missing_token");
	}
	return token;
}

export function getGatewayUrl(): string {
	const url = process.env.PROLIFERATE_GATEWAY_URL;
	if (!url) {
		throw new CliError("PROLIFERATE_GATEWAY_URL not set", ExitCode.Terminal, "missing_gateway_url");
	}
	return url;
}

export function getSessionId(): string {
	const id = process.env.PROLIFERATE_SESSION_ID;
	if (!id) {
		throw new CliError("PROLIFERATE_SESSION_ID not set", ExitCode.Terminal, "missing_session_id");
	}
	return id;
}

export interface GatewayResult<T> {
	envelope: CliEnvelope<T>;
	exitCode: ExitCodeValue;
}

/**
 * Make an authenticated request to the gateway and return an envelope + exit code.
 *
 * Path may contain `:sessionId` which is replaced with the current session ID.
 * On 401, re-reads the token from env and retries once.
 */
export async function gatewayRequest<T>(
	path: string,
	options: RequestInit = {},
): Promise<GatewayResult<T>> {
	const gatewayUrl = getGatewayUrl();
	const sessionId = getSessionId();
	const resolvedPath = path.replace(":sessionId", sessionId);

	const doFetch = async (token: string): Promise<Response> => {
		return fetch(`${gatewayUrl}${resolvedPath}`, {
			...options,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				...(options.headers as Record<string, string> | undefined),
			},
		});
	};

	let token = getSessionToken();
	let response = await doFetch(token);

	// On 401, re-read token from env and retry once
	if (response.status === 401) {
		token = getSessionToken();
		response = await doFetch(token);

		if (response.status === 401) {
			throw new CliError(
				"Authentication failed after token refresh",
				ExitCode.Terminal,
				"auth_expired",
			);
		}
	}

	const body = (await response.json()) as Record<string, unknown>;
	const exitCode = mapHttpStatusToExitCode(response.status);
	const meta = { sessionId };

	if (!response.ok && response.status !== 202) {
		const errorMessage = (body.error as string) ?? `Request failed: ${response.status}`;
		return {
			envelope: errorEnvelope(errorMessage, meta),
			exitCode,
		};
	}

	// 202 = pending_approval: still a success envelope but exit code 4
	return {
		envelope: successEnvelope(body as T, meta),
		exitCode,
	};
}

/**
 * Parse CLI flags from args array.
 * Handles --flag value pairs.
 */
export function parseFlags(args: string[]): Record<string, string> {
	const flags: Record<string, string> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--") && i + 1 < args.length) {
			flags[arg.slice(2)] = args[i + 1];
			i++;
		}
	}
	return flags;
}
