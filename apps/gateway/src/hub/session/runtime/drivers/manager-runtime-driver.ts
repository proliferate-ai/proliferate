import type {
	AutoStartOutputEntry,
	ConfigurationServiceCommand,
	Message,
	SandboxProvider,
} from "@proliferate/shared";
import type { CodingHarnessPromptImage } from "../../../../harness/contracts/coding";
import type { ClaudeManagerHarnessAdapter } from "../../../../harness/manager/adapter";
import type {
	RuntimeDriver,
	RuntimeDriverActivationInput,
	RuntimeDriverExecutionInput,
	RuntimeDriverReadyResult,
} from "../contracts/runtime-driver";
import { reconcileRuntimePointers } from "../state/state-reconciler";

export class ManagerRuntimeDriver implements RuntimeDriver {
	private provider: SandboxProvider | null = null;
	private state: RuntimeDriverExecutionInput | null = null;
	private readonly managerHarness: ClaudeManagerHarnessAdapter;

	constructor(managerHarness: ClaudeManagerHarnessAdapter) {
		this.managerHarness = managerHarness;
	}

	isReady(input: RuntimeDriverExecutionInput): boolean {
		return Boolean(this.provider && input.live.session.sandbox_id);
	}

	async activate(input: RuntimeDriverActivationInput): Promise<RuntimeDriverReadyResult> {
		this.provider = input.provider;
		this.state = { config: input.config, live: input.live };
		const managerHarnessStartMs = Date.now();
		let managerApiKey = input.env.anthropicApiKey;
		let managerProxyUrl: string | undefined;
		if (input.env.llmProxyRequired && input.env.llmProxyUrl) {
			const { generateSessionAPIKey } = await import("@proliferate/shared/llm-proxy");
			managerApiKey = await generateSessionAPIKey(input.sessionId, input.config.organizationId);
			managerProxyUrl = input.env.llmProxyUrl;
		}
		const harnessInput = {
			managerSessionId: input.sessionId,
			organizationId: input.config.organizationId,
			workerId: input.live.session.worker_id,
			gatewayUrl: `http://localhost:${input.env.port}`,
			serviceToken: input.env.serviceToken,
			anthropicApiKey: managerApiKey,
			llmProxyUrl: managerProxyUrl,
		};
		if (input.options?.reason === "auto_reconnect") {
			await this.managerHarness.resume(harnessInput);
		} else {
			await this.managerHarness.start(harnessInput);
		}
		input.logLatency("runtime.ensure_ready.manager_harness.start", {
			durationMs: Date.now() - managerHarnessStartMs,
		});
		input.setEventStreamHandle(null);
		input.live.eventStreamConnected = false;
		reconcileRuntimePointers(input.live, { openCodeSessionId: null });
		return { driverKind: "manager-claude" };
	}

	async sendPrompt(_content: string, _images?: CodingHarnessPromptImage[]): Promise<void> {
		throw new Error("Prompting is not supported for manager runtime driver");
	}

	async interrupt(): Promise<void> {
		return;
	}

	async collectOutputs(): Promise<Message[]> {
		return [];
	}

	disconnectStream(): void {
		if (this.state) {
			this.state.live.eventStreamConnected = false;
		}
	}

	getOpenCodeSessionId(): string | null {
		return null;
	}

	async testAutoStartCommands(
		_runId: string,
		_overrideCommands?: ConfigurationServiceCommand[],
	): Promise<AutoStartOutputEntry[]> {
		return [];
	}
}
