/**
 * Derive a per-session auth token for sandbox-mcp.
 * Uses HMAC-SHA256(serviceToken, sessionId) so both Gateway proxy
 * and sandbox-mcp can independently verify requests.
 */

import { createHmac } from "node:crypto";

export function deriveSandboxMcpToken(serviceToken: string, sessionId: string): string {
	return createHmac("sha256", serviceToken).update(sessionId).digest("hex");
}
