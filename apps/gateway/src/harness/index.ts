export type {
	CodingHarnessAdapter,
	CodingHarnessCollectOutputsInput,
	CodingHarnessCollectOutputsResult,
	CodingHarnessEventStreamHandle,
	CodingHarnessInterruptInput,
	CodingHarnessPromptImage,
	CodingHarnessResumeInput,
	CodingHarnessResumeResult,
	CodingHarnessSendPromptInput,
	CodingHarnessShutdownInput,
	CodingHarnessStartInput,
	CodingHarnessStartResult,
	CodingHarnessStreamInput,
	RuntimeDaemonEvent,
} from "./contracts/coding";

export { normalizeDaemonEvent } from "./daemon/event-normalizer";

export {
	ClaudeManagerHarnessAdapter,
	type ManagerHarnessAdapter,
	type ManagerHarnessState,
} from "./manager/adapter";

export { OpenCodeCodingHarnessAdapter } from "./coding/opencode/adapter";
