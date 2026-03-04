import type Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "@proliferate/logger";
import type { ManagerHarnessStartInput } from "@proliferate/shared/contracts";
import { executeManagerTool } from "../../tools";
import { buildTriageSystemPrompt } from "../prompts";
import type { ManagerToolContext, RunContext, TriageDecision } from "../types";

function extractToolUses(response: Anthropic.Message): Array<Anthropic.ToolUseBlock> {
	return response.content.filter(
		(block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
	);
}

export async function runTriagePhase(params: {
	ctx: RunContext;
	ingestContext: string;
	input: ManagerHarnessStartInput;
	log: Logger;
	callClaude: (systemPrompt: string, log: Logger) => Promise<Anthropic.Message | null>;
	setConversationHistory: (messages: Anthropic.MessageParam[]) => void;
	buildToolContext: (ctx: RunContext, input: ManagerHarnessStartInput) => ManagerToolContext;
	emitTriageEvent: (ctx: RunContext, decision: string, reason?: string) => Promise<void>;
}): Promise<TriageDecision> {
	const {
		ctx,
		ingestContext,
		input,
		log,
		callClaude,
		setConversationHistory,
		buildToolContext,
		emitTriageEvent,
	} = params;

	const systemPrompt = buildTriageSystemPrompt(ctx);
	const userMessage = `Here is the context for this wake cycle:\n\n${ingestContext}\n\nAnalyze this wake event and decide what to do. You must call exactly one of:\n- skip_run: if no action is needed\n- send_notification: to escalate to a human\n- Or describe your plan (you will execute it next)`;
	setConversationHistory([{ role: "user", content: userMessage }]);

	const response = await callClaude(systemPrompt, log);
	if (!response) {
		throw new Error("No response from Claude during triage");
	}

	const toolCtx = buildToolContext(ctx, input);
	const toolUses = extractToolUses(response);

	for (const toolUse of toolUses) {
		if (toolUse.name === "skip_run") {
			const args = toolUse.input as Record<string, unknown>;
			await executeManagerTool("skip_run", args, toolCtx, log);
			await emitTriageEvent(ctx, "skip", args.reason as string);
			log.info({ reason: args.reason }, "Triage: skip");
			return "skip";
		}
		if (toolUse.name === "send_notification") {
			const args = toolUse.input as Record<string, unknown>;
			await executeManagerTool("send_notification", args, toolCtx, log);
			await emitTriageEvent(ctx, "escalate");
			log.info("Triage: escalate");
			return "escalate";
		}
		if (toolUse.name === "complete_run") {
			const args = toolUse.input as Record<string, unknown>;
			await executeManagerTool("complete_run", args, toolCtx, log);
			await emitTriageEvent(ctx, "act", "direct complete");
			return "act";
		}
	}

	await emitTriageEvent(ctx, "act");
	log.info("Triage: act");
	return "act";
}
