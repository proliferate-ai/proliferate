/**
 * Todo/Task List Handler for Slack
 *
 * Stateless - formats in_progress and completed tasks for posting.
 */

import type { HandlerContext, ToolHandler } from "./index";

interface TodoItem {
	id?: string;
	content: string;
	status: "pending" | "in_progress" | "completed";
}

/**
 * Format todos for Slack - shows in_progress and completed tasks
 */
function formatTodoUpdate(todos: TodoItem[]): string | null {
	const completed = todos.filter((t) => t.status === "completed");
	const inProgress = todos.filter((t) => t.status === "in_progress");

	if (completed.length === 0 && inProgress.length === 0) {
		return null;
	}

	const lines: string[] = [];
	const total = todos.length;
	const doneCount = completed.length;

	// Header
	lines.push(`📋 *Tasks (${doneCount}/${total})*`);

	// Show all tasks - simple list
	for (const todo of todos) {
		if (todo.status === "completed") {
			lines.push(`✅ ${todo.content}`);
		} else if (todo.status === "in_progress") {
			lines.push(`🔵 ${todo.content}`);
		} else {
			lines.push(`⚪ ${todo.content}`);
		}
	}

	return lines.join("\n");
}

/**
 * Handler for todowrite tool
 */
export const todoWriteToolHandler: ToolHandler = {
	tools: ["todowrite"],

	async handle(ctx: HandlerContext, _toolName: string, result: string): Promise<void> {
		try {
			const todos = JSON.parse(result);
			if (Array.isArray(todos)) {
				const message = formatTodoUpdate(todos);
				if (message) {
					await ctx.slackClient.postMessage(message);
				}
			}
		} catch {
			// Result wasn't JSON todos, ignore
		}
	},
};
