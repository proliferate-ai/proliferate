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

export type HarnessWorkflowKind = "coding" | "manager";
export type HarnessEngine = "opencode" | "pi";

export type RuntimeLifecycleState =
	| "uninitialized"
	| "starting"
	| "ready"
	| "running"
	| "paused_for_approval"
	| "interrupting"
	| "stopped"
	| "failed";

export type RuntimeEventSource = "runtime" | "gateway_system";
export type RuntimeStreamChannel = "server" | "session" | "message";

/**
 * Canonical event envelope emitted by gateway after normalization.
 * This contract is shared across runtime and web boundaries.
 */
export interface CanonicalRuntimeEventEnvelope {
	protocolVersion: "v1";
	sessionId: string;
	workflowKind: HarnessWorkflowKind;
	engine: HarnessEngine;
	eventSeq: number;
	eventType: string;
	source: RuntimeEventSource;
	bindingId: string;
	sourceEventKey: string;
	ts: string;
	terminal: boolean;
	runId?: string | null;
	itemId?: string | null;
	parentItemId?: string | null;
	toolCallId?: string | null;
	approvalId?: string | null;
	sourceSeq?: number;
	payload: unknown;
}

export interface RuntimeDaemonEvent {
	source: "daemon";
	channel: RuntimeStreamChannel;
	type: string;
	isTerminal: boolean;
	occurredAt: string;
	/** Gateway-issued runtime binding identifier for stale stream fencing. */
	bindingId?: string;
	/** Stable dedupe key for this runtime-originated event. */
	sourceEventKey?: string;
	/** Runtime-side sequence used for reconnect catch-up. */
	sourceSeq?: number;
	/** Canonical merged sequence assigned by gateway. */
	eventSeq?: number;
	runId?: string | null;
	itemId?: string | null;
	parentItemId?: string | null;
	toolCallId?: string | null;
	approvalId?: string | null;
	payload: unknown;
}

export interface HarnessMaterializedSessionView {
	sessionId: string;
	workflowKind: HarnessWorkflowKind;
	engine: HarnessEngine;
	lastEventSeq: number | null;
	lastSourceSeq: number | null;
}

export interface HarnessAttachRequest {
	afterCursor?: string | null;
}

export interface HarnessAttachResponse {
	view: HarnessMaterializedSessionView;
	resumeCursor: string | null;
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
	authToken?: string;
	title?: string;
}

export interface CodingHarnessStartResult {
	sessionId: string;
}

export interface CodingHarnessResumeInput {
	baseUrl: string;
	authToken?: string;
	sessionId?: string | null;
	title?: string;
}

export interface CodingHarnessResumeResult {
	sessionId: string;
	mode: "reused" | "adopted" | "created";
}

export interface CodingHarnessInterruptInput {
	baseUrl: string;
	authToken?: string;
	sessionId: string;
}

export interface CodingHarnessShutdownInput {
	baseUrl: string;
	authToken?: string;
	sessionId: string;
}

export interface CodingHarnessSendPromptInput {
	baseUrl: string;
	authToken?: string;
	sessionId: string;
	content: string;
	images?: CodingHarnessPromptImage[];
}

export interface CodingHarnessCollectOutputsInput {
	baseUrl: string;
	authToken?: string;
	sessionId: string;
}

// ---------------------------------------------------------------------------
// Daemon stream envelope (shared between daemon and gateway)
// ---------------------------------------------------------------------------

export type DaemonStreamType =
	| "pty_out"
	| "fs_change"
	| "agent_event"
	| "port_opened"
	| "port_closed"
	| "sys_event";

export interface DaemonStreamEnvelope {
	v: "1";
	stream: DaemonStreamType;
	seq: number;
	event: "data" | "close" | "error";
	payload: unknown;
	ts: number;
}

// ---------------------------------------------------------------------------
// Workspace state types (used by workspace panels)
// ---------------------------------------------------------------------------

export type WorkspaceSessionState =
	| "running"
	| "paused"
	| "waiting_for_approval"
	| "completed"
	| "failed";

export interface WorkspaceStateInfo {
	state: WorkspaceSessionState;
	/** If paused, reason. */
	pauseReason?: string | null;
	/** If completed or failed, the outcome. */
	outcome?: string | null;
	/** If failed, canonical error code. */
	errorCode?: string | null;
	/** Whether sandbox is still reachable. */
	sandboxAvailable: boolean;
}

export type ServiceStatus = "starting" | "running" | "degraded" | "stopped";

export interface ServiceEntry {
	name: string;
	status: ServiceStatus;
	port?: number | null;
	command?: string;
}

export interface PreviewPort {
	port: number;
	host?: string;
}

export interface FsTreeEntry {
	name: string;
	path: string;
	type: "file" | "directory" | "symlink";
	size?: number;
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
	gatewayAuthToken?: string;
	anthropicApiKey: string;
	llmProxyUrl?: string;
	managerMemoryDir?: string;
	managerMemoryIndexPath?: string;
	hiddenRuntimeDir?: string;
}

export interface ManagerHarnessState {
	managerSessionId: string;
	status: "starting" | "running" | "interrupted" | "stopped" | "idle" | "failed";
	currentRunId?: string;
	managerMemoryDir?: string;
	managerMemoryIndexPath?: string;
	hiddenRuntimeDir?: string;
	statePath?: string;
	transcriptPath?: string;
	lastError?: {
		code: string;
		message: string;
		at: string;
	} | null;
}

export interface ManagerHarnessAdapter {
	readonly name: string;
	start(input: ManagerHarnessStartInput): Promise<ManagerHarnessState>;
	resume(input: ManagerHarnessStartInput): Promise<ManagerHarnessState>;
	interrupt(): Promise<ManagerHarnessState>;
	shutdown(): Promise<ManagerHarnessState>;
}
