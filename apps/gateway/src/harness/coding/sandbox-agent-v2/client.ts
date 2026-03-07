/**
 * Sandbox Agent ACP HTTP client.
 *
 * Communicates with the Rivet Sandbox Agent via the ACP (Agent Client Protocol).
 * The Sandbox Agent runs on port 2468 inside the sandbox, proxied through
 * Caddy at /v1/* on port 20000.
 *
 * ACP endpoints:
 *   POST   /v1/acp              — Create a new ACP server (agent session)
 *   POST   /v1/acp/{serverId}   — Send an envelope (prompt) to the server
 *   GET    /v1/acp/{serverId}   — SSE stream of UniversalEvents
 *   DELETE /v1/acp/{serverId}   — Terminate and clean up the server
 */

const runtimeMutationTimeoutMs = 30_000;

function withAuthHeaders(authToken: string): HeadersInit {
	return {
		Authorization: `Bearer ${authToken}`,
		"Content-Type": "application/json",
	};
}

// ---------------------------------------------------------------------------
// ACP session lifecycle
// ---------------------------------------------------------------------------

export type AcpAgent = "claude" | "opencode" | "pi";

export interface AcpCreateServerResult {
	serverId: string;
}

export async function createAcpServer(
	baseUrl: string,
	authToken: string,
	agent: AcpAgent,
): Promise<AcpCreateServerResult> {
	const response = await fetch(`${baseUrl}/v1/acp`, {
		method: "POST",
		headers: withAuthHeaders(authToken),
		body: JSON.stringify({ agent }),
		signal: AbortSignal.timeout(runtimeMutationTimeoutMs),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`ACP server create failed (${response.status}): ${text}`);
	}
	const payload = (await response.json()) as { server_id?: string; serverId?: string };
	const serverId = payload.server_id ?? payload.serverId;
	if (!serverId) {
		throw new Error("ACP server create returned no server ID");
	}
	return { serverId };
}

export async function sendAcpEnvelope(
	baseUrl: string,
	authToken: string,
	serverId: string,
	content: string,
	images?: Array<{ data: string; mediaType: string }>,
): Promise<void> {
	const parts: Array<{
		type: string;
		text?: string;
		mime?: string;
		url?: string;
		filename?: string;
	}> = [{ type: "text", text: content }];

	for (const image of images ?? []) {
		parts.push({
			type: "file",
			mime: image.mediaType,
			url: `data:${image.mediaType};base64,${image.data}`,
			filename: "image.png",
		});
	}

	const response = await fetch(`${baseUrl}/v1/acp/${encodeURIComponent(serverId)}`, {
		method: "POST",
		headers: withAuthHeaders(authToken),
		body: JSON.stringify({ parts }),
		signal: AbortSignal.timeout(runtimeMutationTimeoutMs),
	});
	if (!response.ok && response.status !== 204) {
		const text = await response.text();
		throw new Error(`ACP envelope send failed (${response.status}): ${text}`);
	}
}

export async function deleteAcpServer(
	baseUrl: string,
	authToken: string,
	serverId: string,
): Promise<void> {
	const response = await fetch(`${baseUrl}/v1/acp/${encodeURIComponent(serverId)}`, {
		method: "DELETE",
		headers: { Authorization: `Bearer ${authToken}` },
		signal: AbortSignal.timeout(runtimeMutationTimeoutMs),
	});
	if (!response.ok && response.status !== 404) {
		const text = await response.text();
		throw new Error(`ACP server delete failed (${response.status}): ${text}`);
	}
}

