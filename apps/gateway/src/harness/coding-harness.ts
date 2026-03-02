import type { Logger } from "@proliferate/logger";
import type { Message } from "@proliferate/shared";
import type {
	CodingHarnessCollectOutputsInput,
	CodingHarnessInterruptInput,
	CodingHarnessResumeInput,
	CodingHarnessResumeResult,
	CodingHarnessSendPromptInput,
	CodingHarnessShutdownInput,
	CodingHarnessStartInput,
	CodingHarnessStartResult,
	RuntimeDaemonEvent,
} from "@proliferate/shared/contracts";
import type { GatewayEnv } from "../lib/env";

// Re-export shared types so existing gateway imports continue to work.
export type {
	RuntimeDaemonEvent,
	CodingHarnessPromptImage,
	CodingHarnessStartInput,
	CodingHarnessStartResult,
	CodingHarnessResumeInput,
	CodingHarnessResumeResult,
	CodingHarnessInterruptInput,
	CodingHarnessShutdownInput,
	CodingHarnessSendPromptInput,
	CodingHarnessCollectOutputsInput,
} from "@proliferate/shared/contracts";

export interface CodingHarnessStreamInput {
	baseUrl: string;
	env: GatewayEnv;
	logger: Logger;
	onEvent: (event: RuntimeDaemonEvent) => void;
	onDisconnect: (reason: string) => void;
}

export interface CodingHarnessEventStreamHandle {
	disconnect: () => void;
}

export interface CodingHarnessCollectOutputsResult {
	messages: Message[];
}

export interface CodingHarnessAdapter {
	readonly name: string;
	start(input: CodingHarnessStartInput): Promise<CodingHarnessStartResult>;
	resume(input: CodingHarnessResumeInput): Promise<CodingHarnessResumeResult>;
	sendPrompt(input: CodingHarnessSendPromptInput): Promise<void>;
	interrupt(input: CodingHarnessInterruptInput): Promise<void>;
	shutdown(input: CodingHarnessShutdownInput): Promise<void>;
	streamEvents(input: CodingHarnessStreamInput): Promise<CodingHarnessEventStreamHandle>;
	collectOutputs(
		input: CodingHarnessCollectOutputsInput,
	): Promise<CodingHarnessCollectOutputsResult>;
}
