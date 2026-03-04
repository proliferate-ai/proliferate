/**
 * Manager Claude harness adapter.
 *
 * Runs a four-phase wake-cycle engine: ingest -> triage -> orchestrate -> finalize.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "@proliferate/logger";
import { sessions, sourceReads, wakes, workers } from "@proliferate/services";
import type {
	ManagerHarnessAdapter,
	ManagerHarnessStartInput,
	ManagerHarnessState,
} from "@proliferate/shared/contracts";
import { callClaudeWithRetry, createAnthropicClient } from "./client";
import { MANAGER_TOOLS, filterToolsByCapabilities } from "./tools";
import { runWakeCyclePhase } from "./wake-cycle/engine";
import { BudgetExhaustedError, PhaseTimeoutError } from "./wake-cycle/errors";
import { runFinalizePhase } from "./wake-cycle/phases/finalize";
import { runIngestPhase } from "./wake-cycle/phases/ingest";
import { runOrchestratePhase } from "./wake-cycle/phases/orchestrate";
import { runTriagePhase } from "./wake-cycle/phases/triage";
import type {
	ManagerToolContext,
	RunContext,
	TriageDecision,
	WakeCyclePhase,
	WakeCycleResult,
} from "./wake-cycle/types";

export class ClaudeManagerHarnessAdapter implements ManagerHarnessAdapter {
	readonly name = "claude-manager";

	private readonly logger: Logger;
	private client: Anthropic | null = null;
	private abortController: AbortController | null = null;
	private conversationHistory: Anthropic.MessageParam[] = [];
	private managerSessionId = "";
	private currentRunId: string | null = null;
	private filteredTools: Anthropic.Tool[] = MANAGER_TOOLS;

	constructor(logger: Logger) {
		this.logger = logger.child({ module: "manager-harness" });
	}

	async start(input: ManagerHarnessStartInput): Promise<ManagerHarnessState> {
		this.managerSessionId = input.managerSessionId;
		this.initClient(input);
		this.conversationHistory = [];

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

	private initClient(input: ManagerHarnessStartInput): void {
		this.client = createAnthropicClient(input);
	}

	private async runWakeCycle(input: ManagerHarnessStartInput): Promise<void> {
		const log = this.logger.child({ managerSessionId: input.managerSessionId });

		if (!input.workerId) {
			log.warn("No worker ID on manager session; cannot run wake cycle");
			return;
		}

		let activeRun = await workers.findActiveRunByWorker(input.workerId, input.organizationId);
		if (!activeRun) {
			log.info("No active run; attempting to claim next queued wake event");
			const orchestrated = await workers.orchestrateNextWakeAndCreateRun(
				input.workerId,
				input.organizationId,
			);
			if (!orchestrated) {
				log.info("No queued wake events; manager idle");
				return;
			}
			activeRun = orchestrated.workerRun;
			log.info(
				{ workerRunId: activeRun.id, wakeEventId: orchestrated.wakeEvent.id },
				"Claimed wake event and created run",
			);
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

		try {
			const capabilities = await sessions.listSessionCapabilities(input.managerSessionId);
			const deniedKeys = new Set(
				capabilities.filter((c) => c.mode === "deny").map((c) => c.capabilityKey),
			);
			this.filteredTools = filterToolsByCapabilities(MANAGER_TOOLS, deniedKeys);
			runLog.debug(
				{ totalTools: MANAGER_TOOLS.length, filteredTools: this.filteredTools.length },
				"Filtered tools by capabilities",
			);
		} catch (err) {
			runLog.warn({ err }, "Failed to load capabilities, using full tool set");
			this.filteredTools = MANAGER_TOOLS;
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
			const ingestContext = await runWakeCyclePhase("ingest", log, () =>
				runIngestPhase({
					ctx,
					log,
					enrichFromWakePayload: (phaseCtx, phaseLog) =>
						this.enrichFromWakePayload(phaseCtx, phaseLog),
				}),
			);
			phasesCompleted.push("ingest");

			triageDecision = await runWakeCyclePhase("triage", log, () =>
				runTriagePhase({
					ctx,
					ingestContext,
					input,
					log,
					callClaude: (systemPrompt, phaseLog) => this.callClaude(systemPrompt, phaseLog),
					setConversationHistory: (messages) => {
						this.conversationHistory = messages;
					},
					buildToolContext: (phaseCtx, phaseInput) => this.buildToolContext(phaseCtx, phaseInput),
					emitTriageEvent: (phaseCtx, decision, reason) =>
						this.emitTriageEvent(phaseCtx, decision, reason),
				}),
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

			const orchestrateResult = await runWakeCyclePhase("orchestrate", log, () =>
				runOrchestratePhase({
					ctx,
					input,
					ingestContext,
					log,
					callClaude: (systemPrompt, phaseLog) => this.callClaude(systemPrompt, phaseLog),
					checkAborted: () => this.checkAborted(),
					buildToolContext: (phaseCtx, phaseInput) => this.buildToolContext(phaseCtx, phaseInput),
					setConversationHistory: (messages) => {
						this.conversationHistory = messages;
					},
					pushConversationMessage: (message) => {
						this.conversationHistory.push(message);
					},
					truncateConversation: () => this.truncateConversation(),
				}),
			);
			phasesCompleted.push("orchestrate");
			childSessionIds.push(...orchestrateResult.childSessionIds);

			const summary = await runWakeCyclePhase("finalize", log, () =>
				runFinalizePhase({ ctx, childSessionIds, log }),
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

	private async callClaude(systemPrompt: string, log: Logger): Promise<Anthropic.Message | null> {
		if (!this.client) throw new Error("Claude client not initialized");
		this.checkAborted();

		const response = await callClaudeWithRetry({
			client: this.client,
			logger: log,
			systemPrompt,
			conversationHistory: this.conversationHistory,
			tools: this.filteredTools,
			abortSignal: this.abortController?.signal,
		});

		this.conversationHistory.push({ role: "assistant", content: response.content });
		return response;
	}

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

	private async enrichFromWakePayload(ctx: RunContext, log: Logger): Promise<string[]> {
		const parts: string[] = [];
		const payload = ctx.wakePayload as Record<string, unknown> | null;
		if (!payload) return parts;

		const sourceRefs = payload.sourceRefs as
			| Array<{ bindingId?: string; itemRef?: string; sourceType?: string; sourceRef?: string }>
			| undefined;

		if (!sourceRefs || !Array.isArray(sourceRefs) || sourceRefs.length === 0) {
			return parts;
		}

		log.info({ refCount: sourceRefs.length }, "Enriching wake context with source data");

		for (const ref of sourceRefs.slice(0, 10)) {
			try {
				if (ref.bindingId && ref.itemRef) {
					const item = await sourceReads.getSourceItem(
						ref.bindingId,
						ctx.organizationId,
						ref.itemRef,
					);
					if (item) {
						parts.push(
							`### [${item.sourceType}] ${item.title}`,
							`- Status: ${item.status ?? "unknown"}`,
							`- Severity: ${item.severity ?? "none"}`,
							`- URL: ${item.url ?? "N/A"}`,
						);
						if (item.body) {
							const truncated =
								item.body.length > 500 ? `${item.body.slice(0, 500)}...` : item.body;
							parts.push(`- Description: ${truncated}`);
						}
						parts.push("");

						await workers.appendWorkerRunEvent({
							workerRunId: ctx.workerRunId,
							workerId: ctx.workerId,
							eventType: "source_observation",
							summaryText: item.title,
							payloadJson: {
								sourceType: item.sourceType,
								sourceRef: item.sourceRef,
								severity: item.severity,
							},
							dedupeKey: `source:${item.sourceType}:${item.sourceRef}`,
						});
					}
				}
			} catch (err) {
				log.warn({ err, ref }, "Failed to enrich source ref");
				parts.push(`### Source ref (fetch failed): ${ref.sourceType ?? "unknown"}`);
			}
		}

		return parts;
	}

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
		let startIdx = this.conversationHistory.length - (maxTurns - 1);

		if (startIdx > 1) {
			const msg = this.conversationHistory[startIdx];
			if (
				msg.role === "user" &&
				Array.isArray(msg.content) &&
				(msg.content as Array<{ type?: string }>).some((b) => b.type === "tool_result")
			) {
				startIdx--;
			}
		}

		const recent = this.conversationHistory.slice(startIdx);
		this.conversationHistory = [first, ...recent];
	}

	private checkAborted(): void {
		if (this.abortController?.signal.aborted) {
			throw new Error("Wake cycle aborted");
		}
	}
}

export type { ManagerHarnessAdapter, ManagerHarnessStartInput, ManagerHarnessState };
