/**
 * Browser Gateway Client
 *
 * Singleton gateway client for browser use with automatic token management.
 * Reuses the same pattern as use-coding-session-runtime.ts
 */

import { type SyncClient, createSyncClient } from "@proliferate/gateway-clients";
import { GATEWAY_URL } from "./gateway";
import { orpc } from "./orpc";

let clientPromise: Promise<SyncClient> | null = null;
let tokenExpiresAt = 0;

/**
 * Get a gateway client instance with a valid token.
 * Caches the client and refreshes token when needed.
 */
async function getClient(): Promise<SyncClient> {
	// If token is still valid (with 5 min buffer), reuse client
	if (clientPromise && tokenExpiresAt > Date.now() + 5 * 60 * 1000) {
		return clientPromise;
	}

	// Fetch new token and create client
	clientPromise = (async () => {
		const { token } = await orpc.auth.wsToken.call({});

		// Token expires in 1 hour, track it
		tokenExpiresAt = Date.now() + 55 * 60 * 1000;

		return createSyncClient({
			baseUrl: GATEWAY_URL,
			auth: { type: "token", token },
		});
	})();

	return clientPromise;
}

/**
 * Extract session ID from S3 key/prefix
 * Format: sessions/{sessionId}/verification/{timestamp}/...
 */
function extractSessionId(keyOrPrefix: string): string {
	const match = keyOrPrefix.match(/^sessions\/([^/]+)\//);
	if (!match) {
		throw new Error("Invalid key format - cannot extract session ID");
	}
	return match[1];
}

/**
 * Browser gateway client for verification media.
 * Uses the SDK's SyncClient under the hood.
 */
export const gatewayClient = {
	async listVerificationFiles(prefix: string) {
		const client = await getClient();
		const sessionId = extractSessionId(prefix);
		return client.tools.verification.list(sessionId, { prefix });
	},

	async getVerificationFileUrl(key: string) {
		const client = await getClient();
		const sessionId = extractSessionId(key);
		return client.tools.verification.getUrl(sessionId, key);
	},

	async getVerificationFileText(key: string) {
		const client = await getClient();
		const sessionId = extractSessionId(key);
		const { data } = await client.tools.verification.getStream(sessionId, key);
		return new TextDecoder().decode(data);
	},
};
