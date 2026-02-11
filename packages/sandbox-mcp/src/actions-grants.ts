/**
 * Actions grant command handlers.
 *
 * Extracted for testability — the CLI's `fatal()` calls `process.exit`,
 * making in-process testing fragile. These pure/async functions use
 * injectable dependencies instead.
 */

// ============================================
// Types
// ============================================

export type GatewayRequestFn = (
	method: string,
	path: string,
	body?: Record<string, unknown>,
) => Promise<{ status: number; data: unknown }>;

export type CommandResult =
	| { ok: true; data: unknown }
	| { ok: false; exitCode: number; errorMessage: string };

export interface GrantRequestParams {
	integration: string;
	action: string;
	scope: "session" | "org";
	maxCalls?: number;
}

// ============================================
// Flag Parsing
// ============================================

/**
 * Parse and validate flags for `actions grant request`.
 * Returns parsed params on success, or an error descriptor on failure.
 */
export function parseGrantRequestFlags(
	flags: Record<string, string | boolean>,
): GrantRequestParams | { error: string; exitCode: number } {
	const integration = flags.integration;
	if (typeof integration !== "string" || integration.length === 0) {
		return { error: "Missing required flag: --integration", exitCode: 2 };
	}

	const action = flags.action;
	if (typeof action !== "string" || action.length === 0) {
		return { error: "Missing required flag: --action", exitCode: 2 };
	}

	const scope = typeof flags.scope === "string" ? flags.scope : "session";
	if (scope !== "session" && scope !== "org") {
		return { error: "--scope must be 'session' or 'org'", exitCode: 2 };
	}

	let maxCalls: number | undefined;
	if (typeof flags["max-calls"] === "string") {
		maxCalls = Number(flags["max-calls"]);
		if (!Number.isInteger(maxCalls) || maxCalls < 1) {
			return { error: "--max-calls must be a positive integer", exitCode: 2 };
		}
	}

	return { integration, action, scope, maxCalls };
}

// ============================================
// Command Executors
// ============================================

/**
 * Execute `actions grant request` — create a grant via the gateway.
 */
export async function executeGrantRequest(
	gatewayRequest: GatewayRequestFn,
	params: GrantRequestParams,
): Promise<CommandResult> {
	const body: Record<string, unknown> = {
		integration: params.integration,
		action: params.action,
		scope: params.scope,
	};
	if (params.maxCalls !== undefined) body.maxCalls = params.maxCalls;

	const { status, data } = await gatewayRequest("POST", "/grants", body);
	if (status >= 400) {
		const err = data as { error?: string; message?: string };
		return { ok: false, exitCode: 1, errorMessage: err.error || err.message || `HTTP ${status}` };
	}
	return { ok: true, data };
}

/**
 * Execute `actions grants list` — list active grants via the gateway.
 */
export async function executeGrantsList(gatewayRequest: GatewayRequestFn): Promise<CommandResult> {
	const { status, data } = await gatewayRequest("GET", "/grants");
	if (status >= 400) {
		const err = data as { error?: string; message?: string };
		return { ok: false, exitCode: 1, errorMessage: err.error || err.message || `HTTP ${status}` };
	}
	return { ok: true, data };
}
