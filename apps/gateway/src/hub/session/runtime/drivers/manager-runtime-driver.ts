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
import type { ManagerRuntimeService } from "../manager/manager-runtime-service";
import type { SessionLiveState } from "../state/session-live-state";
import { reconcileRuntimePointers } from "../state/state-reconciler";

function broadcastDaemonEnvelope(
	onBroadcast: RuntimeDriverActivationInput["onBroadcast"],
	envelope: DaemonStreamEnvelope,
): void {
	if (!onBroadcast || envelope.stream === "agent_event") {
		return;
	}
	onBroadcast({ type: "daemon_stream", payload: envelope } as ServerMessage);
}

export class ManagerRuntimeDriver implements RuntimeDriver {
	private readonly acpHarness = new SandboxAgentV2CodingHarnessAdapter();
	private provider: SandboxProvider | null = null;
	private live: SessionLiveState | null = null;
	private active = false;
	private runtimeBaseUrl: string | null = null;
	private runtimeBindingId: string | null = null;
	private eventStreamHandle: CodingHarnessEventStreamHandle | null = null;
	private readonly managerRuntimeService: ManagerRuntimeService;

	constructor(managerRuntimeService: ManagerRuntimeService) {
		this.managerRuntimeService = managerRuntimeService;
	}

	isReady(input: RuntimeDriverExecutionInput): boolean {
		return Boolean(
			this.active &&
				this.provider &&
				input.live.session.sandbox_id &&
				input.live.previewUrl &&
				input.live.eventStreamConnected,
		);
	}

	async activate(input: RuntimeDriverActivationInput): Promise<RuntimeDriverReadyResult> {
		this.provider = null;
		this.live = input.live;
		this.active = false;
		this.runtimeBaseUrl = input.live.previewUrl;
		this.runtimeBindingId = null;
		if (!this.runtimeBaseUrl) {
			throw new Error("Missing manager runtime daemon endpoint");
		}

		const managerRuntimeStartMs = Date.now();
		try {
			// Start ACP session for Pi
			const acpState = await this.managerRuntimeService.startOrResume(input);
			const bindingId = acpState.serverId;
			this.runtimeBindingId = bindingId;
			input.setRuntimeBindingId(bindingId);

			// Connect SSE streams (ACP agent events + platform events)
			input.setEventStreamHandle(null);
			input.live.eventStreamConnected = false;
			this.eventStreamHandle?.disconnect();
			const sandboxAuthToken = deriveSandboxMcpToken(input.env.serviceToken, input.sessionId);
			this.eventStreamHandle = await connectCodingEventStream({
				codingHarness: this.acpHarness,
				runtimeBaseUrl: this.runtimeBaseUrl,
				authToken: sandboxAuthToken,
				afterSeq: input.live.lastRuntimeSourceSeq ?? undefined,
				bindingId,
				env: input.env,
				logger: input.logger,
				onDisconnect: (reason) => {
					this.eventStreamHandle = null;
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
			});
			input.setEventStreamHandle(this.eventStreamHandle);
			input.live.eventStreamConnected = true;

			this.provider = input.provider;
			this.active = true;
			input.log("Manager runtime ready (Pi via ACP)", {
				serverId: acpState.serverId,
				status: acpState.status,
			});
		} catch (error) {
			this.eventStreamHandle?.disconnect();
			this.provider = null;
			this.active = false;
			this.runtimeBaseUrl = null;
			this.runtimeBindingId = null;
			this.eventStreamHandle = null;
			input.setEventStreamHandle(null);
			input.setRuntimeBindingId(null);
			input.live.eventStreamConnected = false;
			throw error;
		}
		input.logLatency("runtime.ensure_ready.manager_runtime.start", {
			durationMs: Date.now() - managerRuntimeStartMs,
		});
		reconcileRuntimePointers(input.live, { openCodeSessionId: null });
		return { driverKind: "manager-pi", runtimeBindingId: this.runtimeBindingId };
	}

	async sendPrompt(
		_userId: string,
		content: string,
		_images?: CodingHarnessPromptImage[],
	): Promise<void> {
		await this.managerRuntimeService.wake(content);
	}

	async interrupt(): Promise<void> {
		await this.managerRuntimeService.interrupt();
	}

	async collectOutputs(): Promise<Message[]> {
		return [];
	}

	disconnectStream(): void {
		this.eventStreamHandle?.disconnect();
		this.eventStreamHandle = null;
		if (this.live) {
			this.live.eventStreamConnected = false;
		}
	}

	async wake(): Promise<void> {
		const prompt =
			"A new wake event has been queued. " +
			"Use your tools to claim and process it: " +
			"1. Call claim_run to claim the wake event and get its context. If status is 'idle', stop — nothing to do. " +
			"2. Call list_source_bindings to discover available sources. " +
			"3. Call read_source to fetch new items from each binding. " +
			"4. Triage each item — skip_run if no action needed, or spawn_child_task for items that need work. " +
			"5. Call complete_run with a summary when done.";
		await this.managerRuntimeService.wake(prompt);
	}

	getOpenCodeSessionId(): string | null {
		return null;
	}

	getBindingId(): string | null {
		return this.runtimeBindingId;
	}

	async testAutoStartCommands(
		_runId: string,
		_overrideCommands?: ConfigurationServiceCommand[],
	): Promise<AutoStartOutputEntry[]> {
		return [];
	}

	resetState(): void {
		this.disconnectStream();
		this.provider = null;
		this.live = null;
		this.active = false;
		this.runtimeBaseUrl = null;
		this.runtimeBindingId = null;
		this.eventStreamHandle = null;
	}
}
