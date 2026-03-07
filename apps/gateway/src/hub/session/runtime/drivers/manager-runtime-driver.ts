import type {
	AutoStartOutputEntry,
	ConfigurationServiceCommand,
	Message,
	SandboxProvider,
} from "@proliferate/shared";
import type { CodingHarnessPromptImage } from "../../../../harness/contracts/coding";
import type {
	RuntimeDriver,
	RuntimeDriverActivationInput,
	RuntimeDriverExecutionInput,
	RuntimeDriverReadyResult,
} from "../contracts/runtime-driver";
import type { ManagerRuntimeService } from "../manager/manager-runtime-service";
import type { SessionLiveState } from "../state/session-live-state";
import { reconcileRuntimePointers } from "../state/state-reconciler";

export class ManagerRuntimeDriver implements RuntimeDriver {
	private provider: SandboxProvider | null = null;
	private live: SessionLiveState | null = null;
	private active = false;
	private runtimeBindingId: string | null = null;
	private readonly managerRuntimeService: ManagerRuntimeService;

	constructor(managerRuntimeService: ManagerRuntimeService) {
		this.managerRuntimeService = managerRuntimeService;
	}

	isReady(input: RuntimeDriverExecutionInput): boolean {
		return Boolean(this.active && this.provider && input.live.session.sandbox_id);
	}

	async activate(input: RuntimeDriverActivationInput): Promise<RuntimeDriverReadyResult> {
		this.provider = null;
		this.live = input.live;
		this.active = false;
		this.runtimeBindingId = null;
		const managerHarnessStartMs = Date.now();
		try {
			const managerState = await this.managerRuntimeService.startOrResume(input);
			if (managerState.status !== "running") {
				throw new Error(`Manager harness failed to enter running state: ${managerState.status}`);
			}
			this.provider = input.provider;
			this.active = true;
			input.log("Manager harness ready", { currentRunId: managerState.currentRunId ?? null });
		} catch (error) {
			this.provider = null;
			this.active = false;
			throw error;
		}
		input.logLatency("runtime.ensure_ready.manager_harness.start", {
			durationMs: Date.now() - managerHarnessStartMs,
		});
		input.setEventStreamHandle(null);
		input.setRuntimeBindingId(null);
		input.live.eventStreamConnected = false;
		reconcileRuntimePointers(input.live, { openCodeSessionId: null });
		return { driverKind: "manager-claude", runtimeBindingId: null };
	}

	async sendPrompt(_content: string, _images?: CodingHarnessPromptImage[]): Promise<void> {
		throw new Error("Prompting is not supported for manager runtime driver");
	}

	async interrupt(): Promise<void> {
		await this.managerRuntimeService.interrupt();
		this.provider = null;
		this.active = false;
	}

	async collectOutputs(): Promise<Message[]> {
		return [];
	}

	disconnectStream(): void {
		if (this.live) {
			this.live.eventStreamConnected = false;
		}
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
		this.runtimeBindingId = null;
	}
}
