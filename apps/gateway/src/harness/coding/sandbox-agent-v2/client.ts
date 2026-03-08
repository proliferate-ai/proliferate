import { createLogger } from "@proliferate/logger";

const logger = createLogger({ service: "gateway" }).child({
	module: "sandbox-agent-v2-acp",
});

const mutationTimeoutMs = 30_000;
const lookupTimeoutMs = 5_000;

function withAcpUrl(baseUrl: string, path: string): string {
	return `${baseUrl}${path}`;
}

export interface AcpSessionInfo {
	serverId: string;
	agent?: string;
}

/**
 * Create an ACP server by POSTing `initialize` to /v1/acp/{serverId}?agent={agent}.
 * Then creates a Pi session via `session/new` and returns its session ID.
 */
export async function createAcpSession(
	baseUrl: string,
	serverId: string,
	agent: string,
	cwd = "/home/user/workspace",
): Promise<string> {
	const acpUrl = (path: string) => withAcpUrl(baseUrl, path);

	// Step 1: Initialize the ACP server instance
	const initUrl = acpUrl(
		`/v1/acp/${encodeURIComponent(serverId)}?agent=${encodeURIComponent(agent)}`,
	);
	const initResponse = await fetch(initUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 1, clientCapabilities: {} },
		}),
		signal: AbortSignal.timeout(mutationTimeoutMs),
	});
	if (!initResponse.ok) {
		const text = await initResponse.text();
		throw new Error(`ACP initialize failed (${initResponse.status}): ${text}`);
	}

	// Step 2: Create a session inside the agent (required before sending prompts)
	const sessionUrl = acpUrl(`/v1/acp/${encodeURIComponent(serverId)}`);
	const sessionResponse = await fetch(sessionUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 2,
			method: "session/new",
			params: { cwd, mcpServers: [] },
		}),
		signal: AbortSignal.timeout(mutationTimeoutMs),
	});
	if (!sessionResponse.ok) {
		const text = await sessionResponse.text();
		throw new Error(`ACP session/new failed (${sessionResponse.status}): ${text}`);
	}
	const sessionResult = (await sessionResponse.json()) as {
		result?: { sessionId?: string };
	};
	const agentSessionId = sessionResult?.result?.sessionId;
	if (!agentSessionId) {
		throw new Error("ACP session/new did not return a sessionId");
	}
	return agentSessionId;
}

/**
 * Send a prompt to the ACP session via JSON-RPC `session/prompt` request.
 * @param serverId  The sandbox-agent ACP server ID (used in the URL path).
 * @param agentSessionId  The agent-internal session ID (returned by session/new).
 */
export async function sendAcpPrompt(
	baseUrl: string,
	serverId: string,
	content: string,
	agentSessionId?: string,
	_images?: Array<{ data: string; mediaType: string }>,
): Promise<void> {
	const url = withAcpUrl(baseUrl, `/v1/acp/${encodeURIComponent(serverId)}`);
	const promptBlocks: Array<{ type: string; text: string }> = [{ type: "text", text: content }];
	// ACP session/prompt blocks until the agent turn completes, which can take
	// minutes. We fire the request and don't await the response — all progress
	// comes via the SSE stream. We only check the initial HTTP status.
	const promptPromise = fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method: "session/prompt",
			params: {
				sessionId: agentSessionId ?? serverId,
				prompt: promptBlocks,
			},
		}),
	});
	// Log errors in the background but don't block the caller
	promptPromise
		.then((response) => {
			if (!response.ok && response.status !== 202) {
				logger.error(
					{ status: response.status, serverId },
					"ACP prompt response indicated failure",
				);
			}
		})
		.catch((err) => {
			logger.error({ err, serverId }, "ACP prompt request failed");
		});
}

/**
 * Interrupt (cancel) the current ACP session turn via `session/cancel`.
 */
export async function interruptAcpSession(baseUrl: string, serverId: string): Promise<void> {
	const url = withAcpUrl(baseUrl, `/v1/acp/${encodeURIComponent(serverId)}`);
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			method: "session/cancel",
			params: { sessionId: serverId },
		}),
		signal: AbortSignal.timeout(mutationTimeoutMs),
	});
	if (!response.ok && response.status !== 202) {
		const text = await response.text();
		throw new Error(`ACP interrupt failed (${response.status}): ${text}`);
	}
}

/**
 * Close (delete) the ACP session.
 */
export async function closeAcpSession(baseUrl: string, serverId: string): Promise<void> {
	const url = withAcpUrl(baseUrl, `/v1/acp/${encodeURIComponent(serverId)}`);
	const response = await fetch(url, {
		method: "DELETE",
		signal: AbortSignal.timeout(mutationTimeoutMs),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`ACP session close failed (${response.status}): ${text}`);
	}
}

/**
 * List active ACP sessions.
 */
export async function listAcpSessions(baseUrl: string): Promise<AcpSessionInfo[]> {
	const url = withAcpUrl(baseUrl, "/v1/acp");
	const response = await fetch(url, {
		signal: AbortSignal.timeout(lookupTimeoutMs),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`ACP session list failed (${response.status}): ${text}`);
	}
	const payload = (await response.json()) as AcpSessionInfo[] | { servers?: AcpSessionInfo[] };
	if (Array.isArray(payload)) {
		return payload;
	}
	return payload.servers ?? [];
}

export function logAcpLookupError(error: unknown, context: Record<string, unknown>): void {
	logger.debug(
		{
			...context,
			error: error instanceof Error ? error.message : String(error),
		},
		"acp.lookup.error",
	);
}

/**
 * Poll sandbox-agent until it responds to GET /v1/acp.
 * Retries with exponential backoff up to ~30 seconds total.
 */
export async function waitForAcpReady(
	baseUrl: string,
	maxAttempts = 15,
	initialDelayMs = 500,
): Promise<void> {
	let delay = initialDelayMs;
	const startedAt = Date.now();
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const url = withAcpUrl(baseUrl, "/v1/acp");
			const response = await fetch(url, {
				signal: AbortSignal.timeout(3_000),
			});
			if (response.ok) {
				if (attempt > 1) {
					logger.info({ attempt, elapsedMs: Date.now() - startedAt }, "sandbox-agent became ready");
				}
				return;
			}
			// Non-ok but got a response — agent might be starting, keep trying
		} catch {
			// Connection refused / timeout — agent not up yet
		}

		if (attempt < maxAttempts) {
			logger.debug({ attempt, nextDelayMs: delay }, "Waiting for sandbox-agent");
			await new Promise((resolve) => setTimeout(resolve, delay));
			delay = Math.min(delay * 1.5, 5_000);
		}
	}
	throw new Error(`sandbox-agent not ready after ${maxAttempts} attempts`);
}
