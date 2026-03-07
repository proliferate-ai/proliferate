import type { ClientSource } from "@proliferate/shared";

export interface ManagerControlFacade {
	eagerStartSession(sessionId: string): Promise<void>;
	sendPromptToSession(input: {
		sessionId: string;
		content: string;
		userId: string;
		source?: ClientSource;
		images?: string[];
	}): Promise<void>;
	cancelSession(sessionId: string): Promise<void>;
	listCapabilities?(sessionId: string): Promise<Record<string, unknown>>;
	invokeAction?(input: {
		sessionId: string;
		integration: string;
		action: string;
		params: Record<string, unknown>;
	}): Promise<{ status: number; body: Record<string, unknown> }>;
}
