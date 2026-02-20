/**
 * Gateway Clients
 *
 * Typed client for interacting with the Proliferate Gateway.
 * Works in browser, Node workers, and API routes.
 */

// Re-export types from shared
export type {
	ServerMessage,
	ClientMessage,
	Message,
	InitMessage,
	TokenMessage,
	StatusMessage,
	ToolStartMessage,
	ToolEndMessage,
	ToolMetadataMessage,
	ErrorMessage,
	SnapshotResultMessage,
	TextPartCompleteMessage,
} from "@proliferate/shared";

// Base client interface and type guards
export {
	type Client,
	type ClientTools,
	isSyncClient,
	isAsyncClient,
	isExternalClient,
} from "./client";

// Auth types
export type { ServiceAuth, TokenAuth, GatewayAuth } from "./auth";

// Shared types
export type {
	ConnectionOptions,
	ReconnectOptions,
	PostMessageOptions,
	HealthCheckResult,
	SessionStatusResponse,
	SandboxInfo,
	// Session creation types
	SessionType,
	ClientType,
	SandboxMode,
	CreateSessionRequest,
	CreateSessionResponse,
} from "./types";

// SyncClient (browser-safe)
export {
	createSyncClient,
	type SyncClient,
	type SyncClientOptions,
	type SyncWebSocket,
	type WebSocketOptions,
} from "./clients/sync";

// ExternalClient / OpenCodeClient (browser-safe)
export {
	type ExternalClient,
	type ExternalClientOptions,
	ExternalClientBase,
	OpenCodeClient,
	createOpenCodeClient,
	type OpenCodeClientOptions,
} from "./clients/external";

// Server-only exports available at "@proliferate/gateway-clients/server"
