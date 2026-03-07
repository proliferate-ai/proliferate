import type { GitResultCode } from "@proliferate/shared";
import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import type { GitOperations } from "../git/git-operations";
import { runGitActionWorkflow, runGitStatusWorkflow } from "./git-workflow";

describe("git workflow attribution", () => {
	it("passes preferred user to git context refresh for status", async () => {
		const refreshGitContext = vi.fn(async (_preferredGitUserId?: string | null) => {});
		const sendMessage = vi.fn();
		const getStatus = vi.fn(async () => ({ files: [] }));

		await runGitStatusWorkflow(
			{
				ensureRuntimeReady: async () => {},
				refreshGitContext,
				getGitOps: () => ({ getStatus }) as unknown as GitOperations,
				sendMessage,
				logError: () => {},
			},
			{} as WebSocket,
			"/home/user/workspace",
			"user_last_prompt",
		);

		expect(refreshGitContext).toHaveBeenCalledWith("user_last_prompt");
		expect(getStatus).toHaveBeenCalledWith("/home/user/workspace");
	});

	it("passes preferred user to git context refresh for mutate action", async () => {
		const refreshGitContext = vi.fn(async (_preferredGitUserId?: string | null) => {});
		const sendMessage = vi.fn();
		const getStatus = vi.fn(async () => ({ files: [] }));

		await runGitActionWorkflow(
			{
				ensureRuntimeReady: async () => {},
				refreshGitContext,
				getGitOps: () => ({ getStatus }) as unknown as GitOperations,
				sendMessage,
				logError: () => {},
				recordPrUrl: () => {},
			},
			{
				ws: {} as WebSocket,
				action: "commit",
				workspacePath: "/home/user/workspace",
				preferredGitUserId: "user_last_prompt",
				run: async () => ({
					success: true,
					code: "SUCCESS" as GitResultCode,
					message: "ok",
				}),
			},
		);

		expect(refreshGitContext).toHaveBeenCalledWith("user_last_prompt");
	});

	it("aborts mutating git action when refreshGitContext fails", async () => {
		const refreshGitContext = vi.fn(async () => {
			throw new Error("token expired");
		});
		const sendMessage = vi.fn();
		const run = vi.fn();

		await runGitActionWorkflow(
			{
				ensureRuntimeReady: async () => {},
				refreshGitContext,
				getGitOps: () => ({}) as unknown as GitOperations,
				sendMessage,
				logError: () => {},
				recordPrUrl: () => {},
			},
			{
				ws: {} as WebSocket,
				action: "commit",
				workspacePath: "/home/user/workspace",
				preferredGitUserId: "user_abc",
				run,
			},
		);

		expect(run).not.toHaveBeenCalled();
		expect(sendMessage).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				type: "git_result",
				payload: expect.objectContaining({
					action: "commit",
					success: false,
					message: "token expired",
				}),
			}),
		);
	});
});
