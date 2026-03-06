import type { GitResultCode } from "@proliferate/shared";
import type { WebSocket } from "ws";
import type { GitOperations } from "../git/git-operations";

export interface GitWorkflowDeps {
	ensureRuntimeReady: () => Promise<void>;
	refreshGitContext: () => Promise<void>;
	getGitOps: () => GitOperations;
	sendMessage: (ws: WebSocket, message: unknown) => void;
	logError: (message: string, error?: unknown) => void;
}

export async function runGitStatusWorkflow(
	deps: GitWorkflowDeps,
	ws: WebSocket,
	workspacePath?: string,
): Promise<void> {
	await deps.ensureRuntimeReady();
	try {
		await deps.refreshGitContext();
	} catch (err) {
		deps.logError("Failed to refresh git context (using cached values)", err);
	}
	const status = await deps.getGitOps().getStatus(workspacePath);
	deps.sendMessage(ws, { type: "git_status", payload: status });
}

export async function runGitActionWorkflow(
	deps: GitWorkflowDeps & { recordPrUrl: (url: string) => void },
	input: {
		ws: WebSocket;
		action: string;
		workspacePath?: string;
		run: () => Promise<{ success: boolean; code: GitResultCode; message: string; prUrl?: string }>;
	},
): Promise<void> {
	await deps.ensureRuntimeReady();
	try {
		await deps.refreshGitContext();
	} catch (err) {
		deps.logError("Failed to refresh git context (using cached values)", err);
	}
	try {
		const result = await input.run();
		if (result.prUrl) {
			deps.recordPrUrl(result.prUrl);
		}
		deps.sendMessage(input.ws, {
			type: "git_result",
			payload: { action: input.action, ...result },
		});
		if (result.success) {
			const status = await deps.getGitOps().getStatus(input.workspacePath);
			deps.sendMessage(input.ws, { type: "git_status", payload: status });
		}
	} catch (err) {
		deps.sendMessage(input.ws, {
			type: "git_result",
			payload: {
				action: input.action,
				success: false,
				code: "UNKNOWN_ERROR" as GitResultCode,
				message: err instanceof Error ? err.message : "Unknown error",
			},
		});
	}
}
