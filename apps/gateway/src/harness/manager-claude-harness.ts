/**
 * Manager Claude harness adapter.
 *
 * Replaces the no-op stub with a real four-phase wake-cycle engine backed
 * by the Claude SDK. Runs gateway-side as a temporary exception until
 * Phase B builds the sandbox daemon (PR 24).
 *
 * Phases: ingest → triage → orchestrate → finalize
 */

import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import type { Logger } from "@proliferate/logger";
import { sessions, wakes, workers } from "@proliferate/services";
import type {
	ManagerHarnessAdapter,
	ManagerHarnessStartInput,
	ManagerHarnessState,
} from "@proliferate/shared/contracts";
import { MANAGER_TOOLS, executeManagerTool } from "./manager-tools";
import {
	type ManagerToolContext,
	PHASE_TIMEOUT_MS,
	type RunContext,
	type TriageDecision,
	type WakeCyclePhase,
	type WakeCycleResult,
} from "./manager-types";

// Re-export shared types so existing gateway imports continue to work.
export type {
	ManagerHarnessAdapter,
	ManagerHarnessStartInput,
	ManagerHarnessState,
} from "@proliferate/shared/contracts";

const MAX_CONVERSATION_TURNS = 50;
const MAX_RETRY_ATTEMPTS = 1;
const MODEL_ID = "claude-sonnet-4-5-20250929";

// ============================================
// Error Types
// ============================================

class PhaseTimeoutError extends Error {
	readonly phase: WakeCyclePhase;
	constructor(phase: WakeCyclePhase) {
		super(`Phase ${phase} timed out after ${PHASE_TIMEOUT_MS[phase]}ms`);
		this.phase = phase;
	}
}

class BudgetExhaustedError extends Error {}

// ============================================
// Adapter
// ============================================

export class ClaudeManagerHarnessAdapter implements ManagerHarnessAdapter {
	readonly name = "claude-manager";

	private readonly logger: Logger;
	private client: Anthropic | null = null;
	private abortController: AbortController | null = null;
	private conversationHistory: Anthropic.MessageParam[] = [];
	private managerSessionId = "";
	private currentRunId: string | null = null;

	constructor(logger: Logger) {
		this.logger = logger.child({ module: "manager-harness" });
	}

	// ============================================
	// Public Interface
	// ============================================

	async start(input: ManagerHarnessStartInput): Promise<ManagerHarnessState> {
		this.managerSessionId = input.managerSessionId;
		this.initClient(input);
		this.conversationHistory = [];

		// Start wake cycle asynchronously — does not block session runtime
		this.runWakeCycle(input).catch((err) => {
			this.logger.error({ err }, "Fatal error in wake cycle");
		});

		return { managerSessionId: input.managerSessionId, status: "running" };
	}

	async resume(input: ManagerHarnessStartInput): Promise<ManagerHarnessState> {
		this.managerSessionId = input.managerSessionId;
		this.initClient(input);

		this.runWakeCycle(input).catch((err) => {
			this.logger.error({ err }, "Fatal error in resumed wake cycle");
		});

		return {
			managerSessionId: input.managerSessionId,
			status: "running",
			currentRunId: this.currentRunId ?? undefined,
		};
	}

	async interrupt(): Promise<ManagerHarnessState> {
		this.abortController?.abort();
		this.abortController = null;
		return {
			managerSessionId: this.managerSessionId,
			status: "interrupted",
			currentRunId: this.currentRunId ?? undefined,
		};
	}

	async shutdown(): Promise<ManagerHarnessState> {
		this.abortController?.abort();
		this.abortController = null;
		this.client = null;
		this.conversationHistory = [];
		return { managerSessionId: this.managerSessionId, status: "stopped" };
	}

	// ============================================
	// Client Initialization
	// ============================================

	private initClient(input: ManagerHarnessStartInput): void {
		const options: ClientOptions = { apiKey: input.anthropicApiKey };
		if (input.llmProxyUrl) {
			options.baseURL = input.llmProxyUrl;
		}
		this.client = new Anthropic(options);
	}

	// ============================================
	// Wake-Cycle Engine
	// ============================================

	private async runWakeCycle(input: ManagerHarnessStartInput): Promise<void> {
		const log = this.logger.child({ managerSessionId: input.managerSessionId });

		if (!input.workerId) {
			log.warn("No worker ID on manager session; cannot run wake cycle");
			return;
		}

		const activeRun = await workers.findActiveRunByWorker(input.workerId, input.organizationId);
		if (!activeRun) {
			log.info("No active run found for worker; manager idle");
			return;
		}

		this.currentRunId = activeRun.id;
		const runLog = log.child({ workerRunId: activeRun.id, workerId: input.workerId });

		const wakeEvent = await wakes.findWakeEventById(activeRun.wakeEventId, input.organizationId);
		if (!wakeEvent) {
			runLog.error("Wake event not found for active run");
			await this.failRunSafe(
				activeRun.id,
				input.organizationId,
				"WAKE_EVENT_MISSING",
				"Wake event not found",
			);
			return;
		}

		const worker = await workers.findWorkerById(input.workerId, input.organizationId);

		const ctx: RunContext = {
			workerRunId: activeRun.id,
			workerId: input.workerId,
			organizationId: input.organizationId,
			managerSessionId: input.managerSessionId,
			wakeEventId: wakeEvent.id,
			wakeSource: wakeEvent.source,
			wakePayload: wakeEvent.payloadJson,
			workerObjective: worker?.objective ?? null,
			workerName: worker?.name ?? "coworker",
		};

		try {
			await workers.startWorkerRun(activeRun.id, input.organizationId);
		} catch (err) {
			runLog.error({ err }, "Failed to transition run to running");
			return;
		}

		this.abortController = new AbortController();
		const result = await this.executeWakeCycle(ctx, input, runLog);
		await this.finalizeRun(ctx, result, runLog);
		this.currentRunId = null;
		this.abortController = null;
	}

	private async executeWakeCycle(
		ctx: RunContext,
		input: ManagerHarnessStartInput,
		log: Logger,
	): Promise<WakeCycleResult> {
		const phasesCompleted: WakeCyclePhase[] = [];
		let triageDecision: TriageDecision | null = null;
		const childSessionIds: string[] = [];

		try {
			// Phase 1: Ingest
			const ingestContext = await this.runPhase("ingest", log, () => this.runIngestPhase(ctx, log));
			phasesCompleted.push("ingest");

			// Phase 2: Triage
			triageDecision = await this.runPhase("triage", log, () =>
				this.runTriagePhase(ctx, ingestContext, input, log),
			);
			phasesCompleted.push("triage");

			if (triageDecision === "skip") {
				return {
					outcome: "skipped",
					summary: "Triage decided no action needed",
					triageDecision,
					childSessionIds,
					phasesCompleted,
				};
			}
			if (triageDecision === "escalate") {
				return {
					outcome: "escalated",
					summary: "Triage escalated to human",
					triageDecision,
					childSessionIds,
					phasesCompleted,
				};
			}

			// Phase 3: Orchestrate
			const orchestrateResult = await this.runPhase("orchestrate", log, () =>
				this.runOrchestratePhase(ctx, input, log),
			);
			phasesCompleted.push("orchestrate");
			childSessionIds.push(...orchestrateResult.childSessionIds);

			// Phase 4: Finalize
			const summary = await this.runPhase("finalize", log, () =>
				this.runFinalizePhase(ctx, childSessionIds, log),
			);
			phasesCompleted.push("finalize");

			return { outcome: "completed", summary, triageDecision, childSessionIds, phasesCompleted };
		} catch (err) {
			if (err instanceof PhaseTimeoutError) {
				log.error({ phase: err.phase }, "Phase timed out");
				return {
					outcome: "timed_out",
					summary: `Timed out during ${err.phase} phase`,
					triageDecision,
					childSessionIds,
					phasesCompleted,
					error: { code: "PHASE_TIMEOUT", message: err.message },
				};
			}
			if (err instanceof BudgetExhaustedError) {
				log.error("Budget exhausted during wake cycle");
				return {
					outcome: "budget_exhausted",
					summary: "Budget exhausted",
					triageDecision,
					childSessionIds,
					phasesCompleted,
					error: { code: "BUDGET_EXHAUSTED", message: err.message },
				};
			}
			if (this.abortController?.signal.aborted) {
				return {
					outcome: "failed",
					summary: "Interrupted",
					triageDecision,
					childSessionIds,
					phasesCompleted,
					error: { code: "INTERRUPTED", message: "Wake cycle was interrupted" },
				};
			}
			const message = err instanceof Error ? err.message : String(err);
			log.error({ err }, "Unrecoverable error in wake cycle");
			return {
				outcome: "failed",
				summary: `Error: ${message}`,
				triageDecision,
				childSessionIds,
				phasesCompleted,
				error: { code: "UNRECOVERABLE", message },
			};
		}
	}

	// ============================================
	// Phase Runner with Timeout
	// ============================================

	private async runPhase<T>(phase: WakeCyclePhase, log: Logger, fn: () => Promise<T>): Promise<T> {
		const startMs = Date.now();
		log.info({ phase, timeoutMs: PHASE_TIMEOUT_MS[phase] }, `Phase ${phase} starting`);

		let timer: ReturnType<typeof setTimeout>;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new PhaseTimeoutError(phase)), PHASE_TIMEOUT_MS[phase]);
		});

		try {
			const result = await Promise.race([fn(), timeoutPromise]);
			log.info({ phase, durationMs: Date.now() - startMs }, `Phase ${phase} completed`);
			return result;
		} catch (err) {
			log.error({ phase, durationMs: Date.now() - startMs, err }, `Phase ${phase} failed`);
			throw err;
		} finally {
			clearTimeout(timer!);
		}
	}

	// ============================================
	// Phase 1: Ingest
	// ============================================

	private async runIngestPhase(ctx: RunContext, log: Logger): Promise<string> {
		const parts: string[] = [];

		parts.push("## Wake Event");
		parts.push(`- Source: ${ctx.wakeSource}`);
		parts.push(`- Event ID: ${ctx.wakeEventId}`);
		if (ctx.wakePayload) {
			parts.push(`- Payload:\n\`\`\`json\n${JSON.stringify(ctx.wakePayload, null, 2)}\n\`\`\``);
		}

		if (ctx.workerObjective) {
			parts.push("\n## Coworker Objective");
			parts.push(ctx.workerObjective);
		}

		// Check for coalesced events
		try {
			const recentEvents = await workers.listWorkerRunEvents(ctx.workerRunId);
			const wakeStarted = recentEvents.find((e) => e.eventType === "wake_started");
			if (wakeStarted?.payloadJson) {
				const payload = wakeStarted.payloadJson as Record<string, unknown>;
				const coalescedIds = payload.coalescedWakeEventIds;
				if (Array.isArray(coalescedIds) && coalescedIds.length > 0) {
					parts.push(
						`\n## Coalesced Events\n${coalescedIds.length} additional wake events were merged into this one.`,
					);
				}
			}
		} catch {
			// Non-critical
		}

		parts.push(
			"\n## Source Data\nSource reads not yet available. Use the read_source tool to query external data sources.",
		);

		const ingestContext = parts.join("\n");

		await workers.appendWorkerRunEvent({
			workerRunId: ctx.workerRunId,
			workerId: ctx.workerId,
			eventType: "source_observation",
			summaryText: `Ingested wake event (source: ${ctx.wakeSource})`,
			payloadJson: { phase: "ingest", wakeSource: ctx.wakeSource },
		});

		log.info("Ingest phase completed");
		return ingestContext;
	}

	// ============================================
	// Phase 2: Triage
	// ============================================

	private async runTriagePhase(
		ctx: RunContext,
		ingestContext: string,
		input: ManagerHarnessStartInput,
		log: Logger,
	): Promise<TriageDecision> {
		const systemPrompt = buildTriageSystemPrompt(ctx);
		const userMessage = `Here is the context for this wake cycle:\n\n${ingestContext}\n\nAnalyze this wake event and decide what to do. You must call exactly one of:\n- skip_run: if no action is needed\n- send_notification: to escalate to a human\n- Or describe your plan (you will execute it next)`;

		this.conversationHistory = [{ role: "user", content: userMessage }];

		const response = await this.callClaude(systemPrompt, log);
		if (!response) {
			throw new Error("No response from Claude during triage");
		}

		const toolCtx = this.buildToolContext(ctx, input);
		const toolUses = extractToolUses(response);

		for (const toolUse of toolUses) {
			if (toolUse.name === "skip_run") {
				const args = toolUse.input as Record<string, unknown>;
				await executeManagerTool("skip_run", args, toolCtx, log);
				await this.emitTriageEvent(ctx, "skip", args.reason as string);
				log.info({ reason: args.reason }, "Triage: skip");
				return "skip";
			}
			if (toolUse.name === "send_notification") {
				const args = toolUse.input as Record<string, unknown>;
				await executeManagerTool("send_notification", args, toolCtx, log);
				await this.emitTriageEvent(ctx, "escalate");
				log.info("Triage: escalate");
				return "escalate";
			}
			if (toolUse.name === "complete_run") {
				const args = toolUse.input as Record<string, unknown>;
				await executeManagerTool("complete_run", args, toolCtx, log);
				await this.emitTriageEvent(ctx, "act", "direct complete");
				return "act";
			}
		}

		// Default: act
		await this.emitTriageEvent(ctx, "act");
		log.info("Triage: act");
		return "act";
	}

	// ============================================
	// Phase 3: Orchestrate
	// ============================================

	private async runOrchestratePhase(
		ctx: RunContext,
		input: ManagerHarnessStartInput,
		log: Logger,
	): Promise<{ childSessionIds: string[] }> {
		const childSessionIds: string[] = [];
		const toolCtx = this.buildToolContext(ctx, input);
		let turnCount = 0;

		while (turnCount < MAX_CONVERSATION_TURNS) {
			this.checkAborted();
			turnCount++;

			const response = await this.callClaude(buildOrchestrateSystemPrompt(ctx), log);
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
						/* non-critical */
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

			this.conversationHistory.push({ role: "user", content: toolResultBlocks });
			this.truncateConversation();

			if (runFinished) break;
		}

		await workers.appendWorkerRunEvent({
			workerRunId: ctx.workerRunId,
			workerId: ctx.workerId,
			eventType: "manager_note",
			summaryText: `Orchestration: ${turnCount} turns, ${childSessionIds.length} children`,
			payloadJson: { phase: "orchestrate", turns: turnCount, childCount: childSessionIds.length },
		});

		log.info(
			{ turns: turnCount, childCount: childSessionIds.length },
			"Orchestrate phase completed",
		);
		return { childSessionIds };
	}

	// ============================================
	// Phase 4: Finalize
	// ============================================

	private async runFinalizePhase(
		ctx: RunContext,
		childSessionIds: string[],
		log: Logger,
	): Promise<string> {
		const childOutcomes: Array<{
			id: string;
			title: string | null;
			status: string | null;
			outcome: string | null;
		}> = [];
		for (const childId of childSessionIds) {
			const child = await sessions.findSessionById(childId, ctx.organizationId);
			if (child) {
				childOutcomes.push({
					id: child.id,
					title: child.title,
					status: child.status,
					outcome: child.outcome,
				});
			}
		}

		const summaryParts = [`Wake source: ${ctx.wakeSource}`];
		if (childSessionIds.length > 0) {
			summaryParts.push(`Child tasks: ${childSessionIds.length}`);
			for (const co of childOutcomes) {
				summaryParts.push(`  - ${co.title ?? co.id}: ${co.outcome ?? co.status ?? "unknown"}`);
			}
		}
		const summary = summaryParts.join("\n");

		await workers.appendWorkerRunEvent({
			workerRunId: ctx.workerRunId,
			workerId: ctx.workerId,
			eventType: "manager_note",
			summaryText: summary,
			payloadJson: { phase: "finalize", childOutcomes },
		});

		log.info("Finalize phase completed");
		return summary;
	}

	// ============================================
	// Claude SDK Interaction
	// ============================================

	private async callClaude(
		systemPrompt: string,
		log: Logger,
		retryCount = 0,
	): Promise<Anthropic.Message | null> {
		if (!this.client) throw new Error("Claude client not initialized");
		this.checkAborted();

		try {
			const response = await this.client.messages.create(
				{
					model: MODEL_ID,
					max_tokens: 4096,
					system: systemPrompt,
					messages: this.conversationHistory,
					tools: MANAGER_TOOLS,
				},
				{ signal: this.abortController?.signal },
			);

			this.conversationHistory.push({ role: "assistant", content: response.content });
			return response;
		} catch (err) {
			if (
				(err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) &&
				retryCount < MAX_RETRY_ATTEMPTS
			) {
				log.warn({ retryCount, err }, "SDK error, retrying");
				await delay(2000 * (retryCount + 1));
				return this.callClaude(systemPrompt, log, retryCount + 1);
			}
			if (err instanceof Anthropic.APIError && err.status === 402) {
				throw new BudgetExhaustedError("API returned 402: budget exhausted");
			}
			throw err;
		}
	}

	// ============================================
	// Run Finalization
	// ============================================

	private async finalizeRun(ctx: RunContext, result: WakeCycleResult, log: Logger): Promise<void> {
		try {
			if (
				result.outcome === "completed" ||
				result.outcome === "skipped" ||
				result.outcome === "escalated"
			) {
				await workers.completeWorkerRun({
					workerRunId: ctx.workerRunId,
					organizationId: ctx.organizationId,
					summary: result.summary ?? undefined,
					result: result.outcome,
				});
				log.info({ outcome: result.outcome }, "Run finalized successfully");
			} else {
				await workers.failWorkerRun({
					workerRunId: ctx.workerRunId,
					organizationId: ctx.organizationId,
					errorCode: result.error?.code ?? "UNKNOWN",
					errorMessage: result.error?.message,
					retryable: result.outcome === "timed_out",
				});
				log.info(
					{ outcome: result.outcome, errorCode: result.error?.code },
					"Run finalized as failed",
				);
			}
		} catch (err) {
			log.error({ err }, "Failed to finalize run status");
		}
	}

	private async failRunSafe(
		workerRunId: string,
		organizationId: string,
		errorCode: string,
		errorMessage: string,
	): Promise<void> {
		try {
			try {
				await workers.startWorkerRun(workerRunId, organizationId);
			} catch {
				/* may already be running */
			}
			await workers.failWorkerRun({ workerRunId, organizationId, errorCode, errorMessage });
		} catch (err) {
			this.logger.error({ err, workerRunId }, "Failed to fail run");
		}
	}

	// ============================================
	// Helpers
	// ============================================

	private async emitTriageEvent(ctx: RunContext, decision: string, reason?: string): Promise<void> {
		await workers.appendWorkerRunEvent({
			workerRunId: ctx.workerRunId,
			workerId: ctx.workerId,
			eventType: "triage_summary",
			summaryText: `Triage: ${decision}${reason ? ` - ${reason}` : ""}`,
			payloadJson: { phase: "triage", decision, reason },
		});
	}

	private buildToolContext(ctx: RunContext, input: ManagerHarnessStartInput): ManagerToolContext {
		return {
			managerSessionId: ctx.managerSessionId,
			organizationId: ctx.organizationId,
			workerId: ctx.workerId,
			workerRunId: ctx.workerRunId,
			gatewayUrl: input.gatewayUrl,
			serviceToken: input.serviceToken,
		};
	}

	private truncateConversation(): void {
		const maxTurns = 30;
		if (this.conversationHistory.length <= maxTurns) return;
		const first = this.conversationHistory[0];
		const recent = this.conversationHistory.slice(-(maxTurns - 1));
		this.conversationHistory = [first, ...recent];
	}

	private checkAborted(): void {
		if (this.abortController?.signal.aborted) {
			throw new Error("Wake cycle aborted");
		}
	}
}

// ============================================
// System Prompts
// ============================================

function buildTriageSystemPrompt(ctx: RunContext): string {
	return `You are ${ctx.workerName}, an autonomous coworker that processes events and takes action.

Your job is to triage incoming wake events and decide what to do:
- If no action is needed, call skip_run with a reason.
- If the event requires human attention, call send_notification to escalate.
- If you need to spawn coding tasks, describe your plan (you will execute it next).

${ctx.workerObjective ? `Your standing objective: ${ctx.workerObjective}` : ""}

Be concise and decisive. Analyze the context and make a clear decision.`;
}

function buildOrchestrateSystemPrompt(ctx: RunContext): string {
	return `You are ${ctx.workerName}, an autonomous coworker executing tasks.

You are in the orchestration phase. Use your tools to:
1. Spawn child coding tasks with spawn_child_task
2. Monitor progress with list_children and inspect_child
3. Send follow-ups with message_child if needed
4. When done, call complete_run with a summary

${ctx.workerObjective ? `Your standing objective: ${ctx.workerObjective}` : ""}

When you are finished, you must call complete_run.`;
}

// ============================================
// Utilities
// ============================================

function extractToolUses(response: Anthropic.Message): Array<Anthropic.ToolUseBlock> {
	return response.content.filter(
		(block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
	);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
