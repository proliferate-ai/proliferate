import type {
	AutoStartOutputEntry,
	ConfigurationServiceCommand,
	Message,
	SandboxProvider,
} from "@proliferate/shared";
import { OpenCodeCodingHarnessAdapter } from "../../../../harness/coding/opencode/adapter";
import type {
	CodingHarnessEventStreamHandle,
	CodingHarnessPromptImage,
} from "../../../../harness/contracts/coding";
import type {
	RuntimeDriver,
	RuntimeDriverActivationInput,
	RuntimeDriverExecutionInput,
	RuntimeDriverReadyResult,
} from "../contracts/runtime-driver";
import { connectCodingEventStream } from "../event-stream";
import { waitForOpenCodeReady } from "../opencode-ready";
import type { SessionLiveState } from "../state/session-live-state";
import { withStepTiming } from "../timing";
import { persistCodingSessionId } from "../write-authority/runtime-writers";

export class CodingRuntimeDriver implements RuntimeDriver {
	private readonly codingHarness = new OpenCodeCodingHarnessAdapter();
	private openCodeUrl: string | null = null;
	private openCodeSessionId: string | null = null;
	private eventStreamHandle: CodingHarnessEventStreamHandle | null = null;
	private provider: SandboxProvider | null = null;
	private live: SessionLiveState | null = null;
	private serviceCommands: ConfigurationServiceCommand[] | undefined;

	isReady(input: RuntimeDriverExecutionInput): boolean {
		return Boolean(
			input.live.openCodeUrl && input.live.openCodeSessionId && input.live.eventStreamConnected,
		);
	}

	async activate(input: RuntimeDriverActivationInput): Promise<RuntimeDriverReadyResult> {
		this.provider = input.provider;
		this.live = input.live;
		this.serviceCommands = input.config.serviceCommands;
		this.openCodeUrl = input.live.openCodeUrl;
		if (!this.openCodeUrl) {
			throw new Error("Missing agent tunnel URL");
		}

		await withStepTiming("runtime.ensure_ready.opencode_ready", input.logLatency, async () => {
			await waitForOpenCodeReady({
				openCodeUrl: this.openCodeUrl as string,
				log: input.log,
				logError: input.logError,
				loggerWarn: (data, message) => input.logger.warn(data, message),
			});
		});

		const ensureOpenCodeStartMs = Date.now();
		await this.ensureOpenCodeSession(input.sessionId, input.live);
		input.logLatency("runtime.ensure_ready.opencode_session.ensure", {
			durationMs: Date.now() - ensureOpenCodeStartMs,
			hasOpenCodeSessionId: Boolean(input.live.openCodeSessionId),
		});

		this.eventStreamHandle?.disconnect();
		this.eventStreamHandle = await withStepTiming(
			"runtime.ensure_ready.sse.connect",
			input.logLatency,
			() =>
				connectCodingEventStream({
					codingHarness: this.codingHarness,
					openCodeUrl: this.openCodeUrl as string,
					env: input.env,
					logger: input.logger,
					onDisconnect: (reason) => {
						input.live.eventStreamConnected = false;
						input.setEventStreamHandle(null);
						input.onDisconnect(reason);
					},
					onEvent: input.onRuntimeEvent,
					onLog: input.log,
				}),
		);
		input.setEventStreamHandle(this.eventStreamHandle);
		input.live.eventStreamConnected = true;
		return { driverKind: "coding-opencode" };
	}

	async sendPrompt(content: string, images?: CodingHarnessPromptImage[]): Promise<void> {
		if (!this.openCodeUrl || !this.openCodeSessionId) {
			throw new Error("Agent session unavailable");
		}
		await this.codingHarness.sendPrompt({
			baseUrl: this.openCodeUrl,
			sessionId: this.openCodeSessionId,
			content,
			images,
		});
	}

	async interrupt(): Promise<void> {
		if (!this.openCodeUrl || !this.openCodeSessionId) {
			return;
		}
		await this.codingHarness.interrupt({
			baseUrl: this.openCodeUrl,
			sessionId: this.openCodeSessionId,
		});
	}

	async collectOutputs(): Promise<Message[]> {
		if (!this.openCodeUrl || !this.openCodeSessionId) {
			throw new Error("Missing agent session info");
		}
		const result = await this.codingHarness.collectOutputs({
			baseUrl: this.openCodeUrl,
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

	private async ensureOpenCodeSession(
		sessionId: string,
		live: RuntimeDriverExecutionInput["live"],
	): Promise<void> {
		if (!this.openCodeUrl) {
			throw new Error("Agent URL missing");
		}
		const storedId = live.openCodeSessionId ?? live.session.coding_agent_session_id;
		const resumed = await this.codingHarness.resume({
			baseUrl: this.openCodeUrl,
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
		this.openCodeUrl = null;
		this.openCodeSessionId = null;
		this.provider = null;
		this.live = null;
		this.serviceCommands = undefined;
	}
}
