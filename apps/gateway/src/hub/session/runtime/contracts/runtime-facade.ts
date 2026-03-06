import type { ConfigurationServiceCommand, Message, SandboxProvider } from "@proliferate/shared";
import type { CodingHarnessPromptImage } from "../../../../harness/contracts/coding";
import type { SandboxInfo } from "../../../../types";
import type { SessionContext } from "../session-context-store";

export interface RuntimeFacade {
	ensureRuntimeReady(options?: {
		skipMigrationLock?: boolean;
		reason?: "auto_reconnect";
	}): Promise<void>;
	getSandboxInfo(): SandboxInfo;
	getContext(): SessionContext;
	getOpenCodeUrl(): string | null;
	getOpenCodeSessionId(): string | null;
	getPreviewUrl(): string | null;
	getSandboxExpiresAt(): number | null;
	getProviderAndSandboxId(): { provider: SandboxProvider; sandboxId: string } | null;
	sendPrompt(content: string, images?: CodingHarnessPromptImage[]): Promise<void>;
	interruptCurrentRun(): Promise<void>;
	collectOutputs(): Promise<Message[]>;
	disconnectSse(): void;
	resetSandboxState(): void;
	isReady(): boolean;
	isConnecting(): boolean;
	hasOpenCodeUrl(): boolean;
	isSseConnected(): boolean;
	testAutoStartCommands(
		runId: string,
		overrideCommands?: ConfigurationServiceCommand[],
	): Promise<import("@proliferate/shared").AutoStartOutputEntry[]>;
	refreshGitContext(): Promise<void>;
	triggerManagerWakeCycle(): Promise<void>;
}
