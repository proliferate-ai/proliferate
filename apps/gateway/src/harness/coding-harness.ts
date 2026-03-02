import type { Logger } from "@proliferate/logger";
import type { Message } from "@proliferate/shared";
import type { GatewayEnv } from "../lib/env";

export interface RuntimeDaemonEvent {
	source: "daemon";
	channel: "server" | "session" | "message";
	type: string;
	isTerminal: boolean;
	occurredAt: string;
	payload: unknown;
}

export interface CodingHarnessPromptImage {
	data: string;
	mediaType: string;
}

export interface CodingHarnessStartInput {
	baseUrl: string;
	title?: string;
}

export interface CodingHarnessStartResult {
	sessionId: string;
}

export interface CodingHarnessResumeInput {
	baseUrl: string;
	sessionId?: string | null;
	title?: string;
}

export interface CodingHarnessResumeResult {
	sessionId: string;
	mode: "reused" | "adopted" | "created";
}

export interface CodingHarnessInterruptInput {
	baseUrl: string;
	sessionId: string;
}

export interface CodingHarnessShutdownInput {
	baseUrl: string;
	sessionId: string;
}

export interface CodingHarnessSendPromptInput {
	baseUrl: string;
	sessionId: string;
	content: string;
	images?: CodingHarnessPromptImage[];
}

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

export interface CodingHarnessCollectOutputsInput {
	baseUrl: string;
	sessionId: string;
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
