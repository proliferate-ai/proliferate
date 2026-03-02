/**
 * Harness contract interfaces.
 *
 * Pure interfaces shared between gateway and other packages.
 * Types that depend on gateway-specific imports (GatewayEnv, Logger, Message)
 * remain in apps/gateway/src/harness/.
 */

// ---------------------------------------------------------------------------
// Runtime daemon events
// ---------------------------------------------------------------------------

export interface RuntimeDaemonEvent {
	source: "daemon";
	channel: "server" | "session" | "message";
	type: string;
	isTerminal: boolean;
	occurredAt: string;
	payload: unknown;
}

// ---------------------------------------------------------------------------
// Coding harness input/result types (gateway-independent)
// ---------------------------------------------------------------------------

export interface CodingHarnessPromptImage {
	data: string;
	mediaType: string;
}

export interface CodingHarnessStartInput {
	baseUrl: string;
	title?: string;
}

export interface CodingHarnessStartResult {
	sessionId: string;
}

export interface CodingHarnessResumeInput {
	baseUrl: string;
	sessionId?: string | null;
	title?: string;
}

export interface CodingHarnessResumeResult {
	sessionId: string;
	mode: "reused" | "adopted" | "created";
}

export interface CodingHarnessInterruptInput {
	baseUrl: string;
	sessionId: string;
}

export interface CodingHarnessShutdownInput {
	baseUrl: string;
	sessionId: string;
}

export interface CodingHarnessSendPromptInput {
	baseUrl: string;
	sessionId: string;
	content: string;
	images?: CodingHarnessPromptImage[];
}

export interface CodingHarnessCollectOutputsInput {
	baseUrl: string;
	sessionId: string;
}

// ---------------------------------------------------------------------------
// Manager harness
// ---------------------------------------------------------------------------

export interface ManagerHarnessStartInput {
	managerSessionId: string;
	organizationId: string;
	workerId: string | null;
	gatewayUrl: string;
	serviceToken: string;
	anthropicApiKey: string;
	llmProxyUrl?: string;
}

export interface ManagerHarnessState {
	managerSessionId: string;
	status: "running" | "interrupted" | "stopped" | "idle";
	currentRunId?: string;
}

export interface ManagerHarnessAdapter {
	readonly name: string;
	start(input: ManagerHarnessStartInput): Promise<ManagerHarnessState>;
	resume(input: ManagerHarnessStartInput): Promise<ManagerHarnessState>;
	interrupt(): Promise<ManagerHarnessState>;
	shutdown(): Promise<ManagerHarnessState>;
}
