/**
 * automation.complete intercepted tool handler.
 */

import { createLogger } from "@proliferate/logger";
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const logger = createLogger({ service: "gateway" }).child({ module: "tool-automation-complete" });

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
		logger.info(
			{
				sessionId: hub.getSessionId(),
				runId: runId || null,
				completionId: completionId || null,
				outcome: payload.outcome ?? null,
				hasSummary:
					typeof payload.summary_markdown === "string" && payload.summary_markdown.length > 0,
				argKeys: Object.keys(payload),
			},
			"automation.complete.received",
		);

		if (!runId) {
			return { success: false, result: "Missing run_id" };
		}
		if (!UUID_RE.test(runId)) {
			return { success: false, result: "Invalid run_id format (expected UUID)" };
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
		logger.info(
			{
				sessionId: hub.getSessionId(),
				runId,
				completionId,
				outcome,
				triggerEventId: run.triggerEventId,
			},
			"automation.complete.run_completed",
		);

		const eventStatus = outcome === "succeeded" ? "completed" : "failed";
		await triggers.updateEvent(run.triggerEventId, {
			status: eventStatus,
			errorMessage: outcome === "failed" ? "Run failed" : null,
			processedAt: new Date(),
		});

		// Persist outcome + summary and immediately pause the session.
		// This prevents post-completion reconnect/orphan churn from rotating
		// OpenCode session IDs and dropping transcript visibility.
		const pausedAtIso = new Date().toISOString();
		await sessions.updateSession(hub.getSessionId(), {
			status: "paused",
			pausedAt: pausedAtIso,
			pauseReason: "automation_completed",
			outcome,
			summary: payload.summary_markdown ?? null,
			latestTask: null,
		});
		const hubContext = hub.getContext();
		hubContext.session.status = "paused";
		hubContext.session.pause_reason = "automation_completed";
		hubContext.session.outcome = outcome;
		hubContext.session.summary = payload.summary_markdown ?? null;
		hubContext.session.latest_task = null;
		logger.info(
			{
				sessionId: hub.getSessionId(),
				runId,
				outcome,
				sessionStatus: "paused",
				pauseReason: "automation_completed",
			},
			"automation.complete.session_updated",
		);

		// Keep automation sessions alive after completion so users can open the session
		// and inspect the full transcript. Session expiry/cleanup still applies.
		logger.info(
			{
				sessionId: hub.getSessionId(),
				runId,
			},
			"automation.complete.terminate_skipped_preserve_transcript",
		);

		return { success: true, result: "Automation run completed" };
	},
};
