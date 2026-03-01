/**
 * Manager Claude harness adapter.
 *
 * This harness is orchestration-first: it does not own a parallel action/approval
 * model and is expected to call canonical gateway control-plane tools.
 */

export interface ManagerHarnessState {
	managerSessionId: string;
	status: "running" | "interrupted" | "stopped";
}

export interface ManagerHarnessAdapter {
	readonly name: string;
	start(input: { managerSessionId: string }): Promise<ManagerHarnessState>;
	resume(input: { managerSessionId: string }): Promise<ManagerHarnessState>;
	interrupt(input: { managerSessionId: string }): Promise<ManagerHarnessState>;
	shutdown(input: { managerSessionId: string }): Promise<ManagerHarnessState>;
}

export class ClaudeManagerHarnessAdapter implements ManagerHarnessAdapter {
	readonly name = "claude-manager";

	async start(input: { managerSessionId: string }): Promise<ManagerHarnessState> {
		return {
			managerSessionId: input.managerSessionId,
			status: "running",
		};
	}

	async resume(input: { managerSessionId: string }): Promise<ManagerHarnessState> {
		return {
			managerSessionId: input.managerSessionId,
			status: "running",
		};
	}

	async interrupt(input: { managerSessionId: string }): Promise<ManagerHarnessState> {
		return {
			managerSessionId: input.managerSessionId,
			status: "interrupted",
		};
	}

	async shutdown(input: { managerSessionId: string }): Promise<ManagerHarnessState> {
		return {
			managerSessionId: input.managerSessionId,
			status: "stopped",
		};
	}
}
