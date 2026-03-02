/**
 * Manager Claude harness adapter.
 *
 * This harness is orchestration-first: it does not own a parallel action/approval
 * model and is expected to call canonical gateway control-plane tools.
 */

import type { ManagerHarnessAdapter, ManagerHarnessState } from "@proliferate/shared/contracts";

// Re-export shared types so existing gateway imports continue to work.
export type { ManagerHarnessAdapter, ManagerHarnessState } from "@proliferate/shared/contracts";

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
