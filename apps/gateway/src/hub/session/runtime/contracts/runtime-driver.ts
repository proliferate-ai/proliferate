import type {
	AutoStartOutputEntry,
	ConfigurationServiceCommand,
	Message,
	SandboxProvider,
} from "@proliferate/shared";
import type { CodingHarnessPromptImage } from "../../../../harness/contracts/coding";
import type { SessionConfig } from "../state/session-config";
import type { SessionLiveState } from "../state/session-live-state";

export interface RuntimeEnsureOptions {
	skipMigrationLock?: boolean;
	reason?: "auto_reconnect";
}

export interface RuntimeDriverActivationInput {
	sessionId: string;
	env: import("../../../../lib/env").GatewayEnv;
	logger: import("@proliferate/logger").Logger;
	provider: SandboxProvider;
	config: SessionConfig;
	live: SessionLiveState;
	options?: RuntimeEnsureOptions;
	logLatency: (event: string, data?: Record<string, unknown>) => void;
	log: (message: string, data?: Record<string, unknown>) => void;
	logError: (message: string, error?: unknown) => void;
	onRuntimeEvent: (
		event: import("../../../../harness/contracts/coding").RuntimeDaemonEvent,
	) => void;
	onDisconnect: (reason: string) => void;
	setEventStreamHandle: (
		handle: import("../../../../harness/contracts/coding").CodingHarnessEventStreamHandle | null,
	) => void;
	setRuntimeBindingId: (bindingId: string | null) => void;
	onBroadcast?: import("../../../shared/callbacks").BroadcastServerMessageCallback;
}

export interface RuntimeDriverExecutionInput {
	config: SessionConfig;
	live: SessionLiveState;
}

/** Identifies the activated driver for telemetry/logging; selection still uses session kind mapping elsewhere. */
export interface RuntimeDriverReadyResult {
	driverKind: "coding-opencode" | "manager-pi";
	runtimeBindingId?: string | null;
}

export interface RuntimeDriver {
	activate(input: RuntimeDriverActivationInput): Promise<RuntimeDriverReadyResult>;
	isReady(input: RuntimeDriverExecutionInput): boolean;
	sendPrompt(userId: string, content: string, images?: CodingHarnessPromptImage[]): Promise<void>;
	interrupt(): Promise<void>;
	collectOutputs(): Promise<Message[]>;
	disconnectStream(): void;
	resetState(): void;
	getBindingId(): string | null;
	getOpenCodeSessionId(): string | null;
	testAutoStartCommands(
		runId: string,
		overrideCommands?: ConfigurationServiceCommand[],
	): Promise<AutoStartOutputEntry[]>;
}
