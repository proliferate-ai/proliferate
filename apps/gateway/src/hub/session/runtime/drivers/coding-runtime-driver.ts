import { randomUUID } from "crypto";
import type {
	AutoStartOutputEntry,
	ConfigurationServiceCommand,
	Message,
	SandboxProvider,
	ServerMessage,
} from "@proliferate/shared";
import type { DaemonStreamEnvelope } from "@proliferate/shared/contracts/harness";
import { SandboxAgentV2CodingHarnessAdapter } from "../../../../harness/coding/sandbox-agent-v2/adapter";
import type {
	CodingHarnessEventStreamHandle,
	CodingHarnessPromptImage,
} from "../../../../harness/contracts/coding";
import { deriveSandboxMcpToken } from "../../../../server/middleware/auth";
import type {
	RuntimeDriver,
	RuntimeDriverActivationInput,
	RuntimeDriverExecutionInput,
	RuntimeDriverReadyResult,
} from "../contracts/runtime-driver";
import { connectCodingEventStream } from "../event-stream";
import type { SessionLiveState } from "../state/session-live-state";
import { withStepTiming } from "../timing";
import { persistCodingSessionId } from "../write-authority/runtime-writers";

function broadcastDaemonEnvelope(
	onBroadcast: RuntimeDriverActivationInput["onBroadcast"],
	envelope: DaemonStreamEnvelope,
): void {
	if (!onBroadcast) {
		return;
	}
	if (envelope.stream !== "agent_event") {
		onBroadcast({ type: "daemon_stream", payload: envelope } as ServerMessage);
	}

	if (envelope.stream === "port_opened" || envelope.stream === "port_closed") {
		const payload = envelope.payload as { port?: unknown; host?: unknown };
		if (typeof payload.port === "number") {
			onBroadcast({
				type: "port_event",
				payload: {
					action: envelope.stream === "port_opened" ? "opened" : "closed",
					port: payload.port,
					host: typeof payload.host === "string" ? payload.host : undefined,
				},
			} as ServerMessage);
		}
	}

	if (envelope.stream === "fs_change") {
		const payload = envelope.payload as { action?: unknown; path?: unknown; size?: unknown };
		if (typeof payload.action === "string" && typeof payload.path === "string") {
			onBroadcast({
				type: "fs_change",
				payload: {
					action: payload.action as "write" | "delete" | "rename" | "create",
					path: payload.path,
					size: typeof payload.size === "number" ? payload.size : undefined,
				},
			} as ServerMessage);
		}
	}
}

export class CodingRuntimeDriver implements RuntimeDriver {
	private readonly codingHarness = new SandboxAgentV2CodingHarnessAdapter();
	private runtimeBaseUrl: string | null = null;
	private openCodeSessionId: string | null = null;
	private runtimeBindingId: string | null = null;
	private eventStreamHandle: CodingHarnessEventStreamHandle | null = null;
	private provider: SandboxProvider | null = null;
	private live: SessionLiveState | null = null;
	private serviceCommands: ConfigurationServiceCommand[] | undefined;

	isReady(input: RuntimeDriverExecutionInput): boolean {
		return Boolean(
			input.live.previewUrl && input.live.openCodeSessionId && input.live.eventStreamConnected,
		);
	}

	async activate(input: RuntimeDriverActivationInput): Promise<RuntimeDriverReadyResult> {
		this.provider = input.provider;
		this.live = input.live;
		this.serviceCommands = input.config.serviceCommands;
		this.runtimeBaseUrl = input.live.previewUrl;
		if (!this.runtimeBaseUrl) {
			throw new Error("Missing sandbox runtime endpoint");
		}

		// Ensure or create an ACP session via sandbox-agent
		const ensureAcpStartMs = Date.now();
		await this.ensureAcpSession(input.sessionId, input.live);
		input.logLatency("runtime.ensure_ready.acp_session.ensure", {
			durationMs: Date.now() - ensureAcpStartMs,
			hasOpenCodeSessionId: Boolean(input.live.openCodeSessionId),
		});

		this.runtimeBindingId = this.openCodeSessionId ?? randomUUID();
		input.setRuntimeBindingId(this.runtimeBindingId);

		this.eventStreamHandle?.disconnect();
		const sandboxAuthToken = deriveSandboxMcpToken(input.env.serviceToken, input.sessionId);
		this.eventStreamHandle = await withStepTiming(
			"runtime.ensure_ready.sse.connect",
			input.logLatency,
			() =>
				connectCodingEventStream({
					codingHarness: this.codingHarness,
					runtimeBaseUrl: this.runtimeBaseUrl as string,
					authToken: sandboxAuthToken,
					afterSeq: input.live.lastRuntimeSourceSeq ?? undefined,
					bindingId: this.runtimeBindingId as string,
					env: input.env,
					logger: input.logger,
					onDisconnect: (reason) => {
						input.live.eventStreamConnected = false;
						input.setEventStreamHandle(null);
						input.onDisconnect(reason);
					},
					onEvent: (event) => {
						if (typeof event.sourceSeq === "number") {
							input.live.lastRuntimeSourceSeq = event.sourceSeq;
						}
						input.onRuntimeEvent(event);
					},
					onDaemonEnvelope: (envelope) => {
						broadcastDaemonEnvelope(input.onBroadcast, envelope);
					},
					onLog: input.log,
				}),
		);
		input.setEventStreamHandle(this.eventStreamHandle);
		input.live.eventStreamConnected = true;
		return { driverKind: "coding-opencode", runtimeBindingId: this.runtimeBindingId };
	}

	async sendPrompt(
		_userId: string,
		content: string,
		images?: CodingHarnessPromptImage[],
	): Promise<void> {
		if (!this.runtimeBaseUrl || !this.openCodeSessionId) {
			throw new Error("Agent session unavailable");
		}
		await this.codingHarness.sendPrompt({
			baseUrl: this.runtimeBaseUrl,
			sessionId: this.openCodeSessionId,
			content,
			images,
		});
	}

	async interrupt(): Promise<void> {
		if (!this.runtimeBaseUrl || !this.openCodeSessionId) {
			return;
		}
		await this.codingHarness.interrupt({
			baseUrl: this.runtimeBaseUrl,
			sessionId: this.openCodeSessionId,
		});
	}

	async collectOutputs(): Promise<Message[]> {
		if (!this.runtimeBaseUrl || !this.openCodeSessionId) {
			throw new Error("Missing agent session info");
		}
		const result = await this.codingHarness.collectOutputs({
			baseUrl: this.runtimeBaseUrl,
			sessionId: this.openCodeSessionId,
		});
		return result.messages;
	}

	disconnectStream(): void {
		this.eventStreamHandle?.disconnect();
		this.eventStreamHandle = null;
		if (this.live) {
			this.live.eventStreamConnected = false;
		}
	}

	getOpenCodeSessionId(): string | null {
		return this.openCodeSessionId;
	}

	getBindingId(): string | null {
		return this.runtimeBindingId;
	}

	async testAutoStartCommands(
		runId: string,
		overrideCommands?: ConfigurationServiceCommand[],
	): Promise<AutoStartOutputEntry[]> {
		if (!this.provider || !this.live) {
			throw new Error("Runtime not ready");
		}
		const sandboxId = this.live.session.sandbox_id;
		const commands = overrideCommands !== undefined ? overrideCommands : this.serviceCommands;
		if (!this.provider.testServiceCommands || !sandboxId) {
			throw new Error("Runtime not ready");
		}
		if (!commands?.length) {
			return [];
		}
		return this.provider.testServiceCommands(sandboxId, commands, {
			timeoutMs: 10_000,
			runId,
		});
	}

	private async ensureAcpSession(
		sessionId: string,
		live: RuntimeDriverExecutionInput["live"],
	): Promise<void> {
		if (!this.runtimeBaseUrl) {
			throw new Error("Agent URL missing");
		}
		const storedId = live.openCodeSessionId ?? live.session.coding_agent_session_id;
		const resumed = await this.codingHarness.resume({
			baseUrl: this.runtimeBaseUrl,
			sessionId: storedId,
		});
		this.openCodeSessionId = resumed.sessionId;
		await persistCodingSessionId({
			sessionId,
			live,
			codingSessionId: resumed.sessionId,
		});
	}

	resetState(): void {
		this.disconnectStream();
		this.runtimeBaseUrl = null;
		this.openCodeSessionId = null;
		this.runtimeBindingId = null;
		this.provider = null;
		this.live = null;
		this.serviceCommands = undefined;
	}
}
