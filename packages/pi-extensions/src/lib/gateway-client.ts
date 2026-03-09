/**
 * Gateway HTTP client for Pi manager tool extensions.
 *
 * Reads connection details from sandbox environment variables and provides
 * a helper to execute manager tools via the gateway control-plane API.
 */

// biome-ignore lint/nursery/noProcessEnv: runs inside sandbox, not in app
const GATEWAY_URL = process.env.PROLIFERATE_GATEWAY_URL;
// biome-ignore lint/nursery/noProcessEnv: runs inside sandbox, not in app
const AUTH_TOKEN = process.env.PROLIFERATE_GATEWAY_AUTH_TOKEN;
// biome-ignore lint/nursery/noProcessEnv: runs inside sandbox, not in app
const SESSION_ID = process.env.PROLIFERATE_MANAGER_SESSION_ID;

export function requireEnv(): void {
	if (!GATEWAY_URL || !AUTH_TOKEN || !SESSION_ID) {
		throw new Error(
			"Missing required environment variables: PROLIFERATE_GATEWAY_URL, PROLIFERATE_GATEWAY_AUTH_TOKEN, PROLIFERATE_MANAGER_SESSION_ID",
		);
	}
}

export async function executeToolViaGateway(
	toolName: string,
	args: Record<string, unknown>,
): Promise<string> {
	requireEnv();

	const url = `${GATEWAY_URL}/proliferate/${SESSION_ID}/manager/tools/execute`;
	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${AUTH_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ toolName, args }),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		const safeBody = body.replace(/[\n\r]/g, " ").slice(0, 200);
		throw new Error(`Manager tool ${toolName} failed (${response.status}): ${safeBody}`);
	}

	const json = (await response.json()) as { result?: string };
	return json.result ?? JSON.stringify(json);
}
