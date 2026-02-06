// Gateway URL utilities
// The gateway URL is computed from session ID rather than stored in the database
// Uses NEXT_PUBLIC_ prefix so it's available on both client and server

import { env } from "@proliferate/environment/public";

export const GATEWAY_URL = env.NEXT_PUBLIC_GATEWAY_URL;

/**
 * Get the gateway URL for a session
 */
export function getSessionGatewayUrl(sessionId: string): string {
	return `${GATEWAY_URL}/session/${sessionId}`;
}

/**
 * Get the WebSocket URL for a session
 */
export function getSessionWebSocketUrl(sessionId: string, token: string): string {
	const gatewayUrl = getSessionGatewayUrl(sessionId);
	const wsUrl = gatewayUrl.replace("https://", "wss://").replace("http://", "ws://");
	return `${wsUrl}?token=${encodeURIComponent(token)}`;
}
