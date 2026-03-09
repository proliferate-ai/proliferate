import type { ClientSource } from "@proliferate/shared";
import type { ManagerControlFacade } from "../../../../harness/manager/control-facade";

export interface ManagerControlTarget {
	eagerStart(): Promise<void>;
	postPrompt(
		content: string,
		userId: string,
		source?: ClientSource,
		images?: string[],
	): Promise<void>;
	postCancel(): void;
}

export interface InProcessManagerControlFacadeOptions {
	getOrCreateHub(sessionId: string): Promise<ManagerControlTarget>;
}

export function createInProcessManagerControlFacade(
	options: InProcessManagerControlFacadeOptions,
): ManagerControlFacade {
	return {
		async eagerStartSession(sessionId) {
			const hub = await options.getOrCreateHub(sessionId);
			await hub.eagerStart();
		},

		async sendPromptToSession(input) {
			const hub = await options.getOrCreateHub(input.sessionId);
			await hub.postPrompt(input.content, input.userId, input.source, input.images);
		},

		async cancelSession(sessionId) {
			const hub = await options.getOrCreateHub(sessionId);
			hub.postCancel();
		},
	};
}
