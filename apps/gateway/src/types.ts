/**
 * Gateway Types
 *
 * Shared types for the gateway server.
 */

import type { SessionHub } from "./hub/session-hub";

/**
 * Session status values
 */
export const SessionStatus = {
	CREATING: "creating",
	RESUMING: "resuming",
	RUNNING: "running",
	MIGRATING: "migrating",
	PAUSED: "paused",
	STOPPED: "stopped",
	ERROR: "error",
} as const;

export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

/**
 * Auth result from token verification
 */
export interface AuthResult {
	userId?: string;
	orgId?: string;
	source: "jwt" | "cli" | "service";
}

/**
 * Extend Express Request with our custom properties.
 * These are added by middleware and available on all routes.
 */
declare global {
	namespace Express {
		interface Request {
			auth?: AuthResult;
			hub?: SessionHub;
			proliferateSessionId?: string;
		}
	}
}

/**
 * OpenCode SSE event - base type
 */
export interface OpenCodeEventBase {
	type: string;
	properties: Record<string, unknown>;
}

/**
 * OpenCode part update event properties
 */
export interface PartUpdateProperties {
	part: {
		id: string;
		sessionID: string;
		messageID: string;
		type: string;
		text?: string;
		callID?: string;
		tool?: string;
		state?: {
			status: string;
			input?: Record<string, unknown>;
			output?: string;
			error?: string;
			metadata?: {
				summary?: Array<{
					id: string;
					tool: string;
					state: { status: string; title?: string };
				}>;
				sessionId?: string;
			};
			title?: string;
		};
	};
	delta?: string;
}

/**
 * OpenCode session status event properties
 */
export interface SessionStatusProperties {
	status?: { type?: string };
}

/**
 * OpenCode session error event properties
 */
export interface SessionErrorProperties {
	error?: { name?: string; data?: { message?: string } };
}

/**
 * Discriminated union of OpenCode SSE events
 */
export type OpenCodeEvent =
	| { type: "server.connected"; properties: Record<string, unknown> }
	| { type: "server.heartbeat"; properties: Record<string, unknown> }
	| { type: "message.part.updated"; properties: PartUpdateProperties }
	| { type: "session.idle"; properties: SessionStatusProperties }
	| { type: "session.status"; properties: SessionStatusProperties }
	| { type: "session.error"; properties: SessionErrorProperties };

/**
 * Tool execution state
 */
export interface ToolState {
	startEmitted: boolean;
	argsEmitted: boolean;
	endEmitted: boolean;
	status: "running" | "completed" | "error";
}

/**
 * Client connection info
 */
export interface ClientConnection {
	connectionId: string;
	userId?: string;
}

/**
 * Sandbox info returned from getSandboxInfo
 */
export interface SandboxInfo {
	sessionId: string;
	sandboxId: string | null;
	status: string;
	previewUrl: string | null;
	sshHost: string | null;
	sshPort: number | null;
	expiresAt: number | null;
}
