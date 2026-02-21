/**
 * automation.complete intercepted tool handler.
 */

import { runs, sessions, triggers } from "@proliferate/services";
import type { InterceptedToolHandler, InterceptedToolResult } from "./index";

interface AutomationCompleteArgs {
	run_id?: string;
	runId?: string;
	completion_id?: string;
	completionId?: string;
	outcome?: string;
	summary_markdown?: string;
	[key: string]: unknown;
}

const VALID_OUTCOMES = new Set(["succeeded", "failed", "needs_human"] as const);
const OUTCOME_TO_TRIGGER_EVENT_STATUS = {
	succeeded: "completed",
	failed: "failed",
	needs_human: "skipped",
} as const;

function normalizeOutcome(
	outcome: string | undefined,
): "succeeded" | "failed" | "needs_human" | null {
	if (!outcome || !VALID_OUTCOMES.has(outcome as never)) return null;
	return outcome as "succeeded" | "failed" | "needs_human";
}

export const automationCompleteHandler: InterceptedToolHandler = {
	name: "automation.complete",
	async execute(hub, args): Promise<InterceptedToolResult> {
		const payload = args as AutomationCompleteArgs;
		const runId = String(payload.run_id ?? payload.runId ?? "").trim();
		const completionId = String(payload.completion_id ?? payload.completionId ?? "").trim();

		if (!runId) {
			return { success: false, result: "Missing run_id" };
		}
		if (!completionId) {
			return { success: false, result: "Missing completion_id" };
		}

		const outcome = normalizeOutcome(payload.outcome);
		if (!outcome) {
			return {
				success: false,
				result: `Invalid outcome: "${payload.outcome}". Must be one of: succeeded, failed, needs_human`,
			};
		}

		const run = await runs.completeRun({
			runId,
			completionId,
			outcome,
			completionJson: payload as Record<string, unknown>,
			sessionId: hub.getSessionId(),
		});

		if (!run) {
			return { success: false, result: "Run not found" };
		}

		const eventStatus = OUTCOME_TO_TRIGGER_EVENT_STATUS[outcome];
		await triggers.updateEvent(run.triggerEventId, {
			status: eventStatus,
			errorMessage:
				outcome === "failed"
					? "Run failed"
					: outcome === "needs_human"
						? "Run requires human review"
						: null,
			processedAt: new Date(),
		});

		// Persist outcome + summary to session before terminal cleanup
		await sessions.updateSession(hub.getSessionId(), {
			outcome,
			summary: payload.summary_markdown ?? null,
		});

		// Automation Fast-Path: schedule terminal cleanup after response is sent.
		// Automations are terminal — no snapshot needed. Fire-and-forget.
		setTimeout(() => {
			hub.terminateForAutomation().catch(() => {
				// Best-effort — already logged inside terminateForAutomation
			});
		}, 0);

		return { success: true, result: "Automation run completed" };
	},
};
