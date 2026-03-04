import type Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "@proliferate/logger";
import { workers } from "@proliferate/services";
import type { ManagerHarnessStartInput } from "@proliferate/shared/contracts";
import { executeManagerTool } from "../../tools";
import { buildOrchestrateSystemPrompt } from "../prompts";
import type { ManagerToolContext, RunContext } from "../types";

const MAX_CONVERSATION_TURNS = 15;

function extractToolUses(response: Anthropic.Message): Array<Anthropic.ToolUseBlock> {
	return response.content.filter(
		(block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
	);
}

export async function runOrchestratePhase(params: {
	ctx: RunContext;
	input: ManagerHarnessStartInput;
	ingestContext: string;
	log: Logger;
	callClaude: (systemPrompt: string, log: Logger) => Promise<Anthropic.Message | null>;
	checkAborted: () => void;
	buildToolContext: (ctx: RunContext, input: ManagerHarnessStartInput) => ManagerToolContext;
	setConversationHistory: (messages: Anthropic.MessageParam[]) => void;
	pushConversationMessage: (message: Anthropic.MessageParam) => void;
	truncateConversation: () => void;
}): Promise<{ childSessionIds: string[] }> {
	const {
		ctx,
		input,
		ingestContext,
		log,
		callClaude,
		checkAborted,
		buildToolContext,
		setConversationHistory,
		pushConversationMessage,
		truncateConversation,
	} = params;

	const childSessionIds: string[] = [];
	const toolCtx = buildToolContext(ctx, input);
	let turnCount = 0;

	setConversationHistory([
		{
			role: "user",
			content: `Triage decided to act. Here is the context:\n\n${ingestContext}\n\nExecute the planned work using your tools. Call complete_run when done.`,
		},
	]);

	while (turnCount < MAX_CONVERSATION_TURNS) {
		checkAborted();
		turnCount++;

		const response = await callClaude(buildOrchestrateSystemPrompt(ctx), log);
		if (!response) break;

		const toolUses = extractToolUses(response);
		if (toolUses.length === 0) break;

		const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
		let runFinished = false;

		for (const toolUse of toolUses) {
			const args = (toolUse.input ?? {}) as Record<string, unknown>;
			const result = await executeManagerTool(toolUse.name, args, toolCtx, log);

			if (toolUse.name === "spawn_child_task") {
				try {
					const parsed = JSON.parse(result);
					if (parsed.session_id) childSessionIds.push(parsed.session_id);
				} catch {
					// Non-critical.
				}
			}

			toolResultBlocks.push({
				type: "tool_result",
				tool_use_id: toolUse.id,
				content: result,
			});

			if (toolUse.name === "complete_run" || toolUse.name === "skip_run") {
				runFinished = true;
			}
		}

		pushConversationMessage({ role: "user", content: toolResultBlocks });
		truncateConversation();

		if (runFinished) break;
	}

	await workers.appendWorkerRunEvent({
		workerRunId: ctx.workerRunId,
		workerId: ctx.workerId,
		eventType: "manager_note",
		summaryText: `Orchestration: ${turnCount} turns, ${childSessionIds.length} children`,
		payloadJson: { phase: "orchestrate", turns: turnCount, childCount: childSessionIds.length },
	});

	log.info({ turns: turnCount, childCount: childSessionIds.length }, "Orchestrate phase completed");
	return { childSessionIds };
}
