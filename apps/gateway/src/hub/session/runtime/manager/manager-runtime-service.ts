import type { ManagerHarnessStartInput, ManagerHarnessState } from "@proliferate/shared/contracts";
import type { ClaudeManagerHarnessAdapter } from "../../../../harness/manager/adapter";
import type { RuntimeDriverActivationInput } from "../contracts/runtime-driver";

const DEFAULT_MANAGER_MEMORY_DIR = "/workspace/.proliferate/manager-memory";

export class ManagerRuntimeService {
	constructor(private readonly managerHarness: ClaudeManagerHarnessAdapter) {}

	async startOrResume(input: RuntimeDriverActivationInput): Promise<ManagerHarnessState> {
		let managerApiKey = input.env.anthropicApiKey;
		let managerProxyUrl: string | undefined;
		if (input.env.llmProxyRequired && input.env.llmProxyUrl) {
			const { generateSessionAPIKey } = await import("@proliferate/shared/llm-proxy");
			managerApiKey = await generateSessionAPIKey(input.sessionId, input.config.organizationId);
			managerProxyUrl = input.env.llmProxyUrl;
		}

		const memoryDir = DEFAULT_MANAGER_MEMORY_DIR;
		const harnessInput: ManagerHarnessStartInput = {
			managerSessionId: input.sessionId,
			organizationId: input.config.organizationId,
			workerId: input.live.session.worker_id,
			gatewayUrl: `http://localhost:${input.env.port}`,
			serviceToken: input.env.serviceToken,
			anthropicApiKey: managerApiKey,
			llmProxyUrl: managerProxyUrl,
			managerMemoryDir: memoryDir,
			managerMemoryIndexPath: `${memoryDir}/memory.md`,
		};

		if (input.options?.reason === "auto_reconnect") {
			return this.managerHarness.resume(harnessInput);
		}
		return this.managerHarness.start(harnessInput);
	}

	async interrupt(): Promise<void> {
		await this.managerHarness.interrupt();
	}
}
