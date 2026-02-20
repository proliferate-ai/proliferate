/**
 * Automation workers (runs v2).
 */

import { env } from "@proliferate/environment/server";
import { createSyncClient } from "@proliferate/gateway-clients";
import type { SyncClient } from "@proliferate/gateway-clients";
import type { Logger } from "@proliferate/logger";
import {
	createAutomationEnrichQueue,
	createAutomationEnrichWorker,
	createAutomationExecuteQueue,
	createAutomationExecuteWorker,
	getConnectionOptions,
	queueAutomationEnrich,
	queueAutomationExecute,
} from "@proliferate/queue";
import { notifications, outbox, runs, triggers } from "@proliferate/services";
import type { Worker } from "bullmq";
import { writeCompletionArtifact, writeEnrichmentArtifact } from "./artifacts";
import { EnrichmentError, buildEnrichmentPayload } from "./enrich";
import { type FinalizerDeps, finalizeOneRun } from "./finalizer";
import { dispatchRunNotification, dispatchSessionNotification } from "./notifications";
import { resolveTarget } from "./resolve-target";

const LEASE_TTL_MS = 5 * 60 * 1000;
const OUTBOX_POLL_INTERVAL_MS = 2000;
const FINALIZER_INTERVAL_MS = 60 * 1000;
const INACTIVITY_MS = 30 * 60 * 1000;

interface AutomationWorkers {
	enrichWorker: Worker;
	executeWorker: Worker;
	outboxInterval: NodeJS.Timeout;
	finalizerInterval: NodeJS.Timeout;
}

export function startAutomationWorkers(logger: Logger): AutomationWorkers {
	const gatewayUrl = env.NEXT_PUBLIC_GATEWAY_URL;
	const serviceToken = env.SERVICE_TO_SERVICE_AUTH_TOKEN;
	if (!gatewayUrl || !serviceToken) {
		throw new Error("Gateway URL or service token not configured");
	}

	const syncClient = createSyncClient({
		baseUrl: gatewayUrl,
		auth: { type: "service", name: "worker-automation", secret: serviceToken },
		source: "automation",
	});

	const connection = getConnectionOptions();
	const enrichQueue = createAutomationEnrichQueue(connection);
	const executeQueue = createAutomationExecuteQueue(connection);

	const enrichWorker = createAutomationEnrichWorker(async (job) => {
		await handleEnrich(job.data.runId, logger);
	});

	const executeWorker = createAutomationExecuteWorker(async (job) => {
		await handleExecute(job.data.runId, syncClient, logger);
	});

	const outboxInterval = setInterval(() => {
		dispatchOutbox(enrichQueue, executeQueue, logger).catch((err) => {
			const cause = err?.cause?.message ?? err?.message ?? String(err);
			logger.error({ err }, `Outbox dispatch failed: ${cause}`);
		});
	}, OUTBOX_POLL_INTERVAL_MS);

	const finalizerInterval = setInterval(() => {
		finalizeRuns(syncClient, logger).catch((err) => {
			logger.error({ err }, "Finalizer tick failed");
		});
	}, FINALIZER_INTERVAL_MS);

	logger.info("Workers started: enrich, execute, outbox, finalizer");

	return { enrichWorker, executeWorker, outboxInterval, finalizerInterval };
}

export async function stopAutomationWorkers(workers: AutomationWorkers): Promise<void> {
	clearInterval(workers.outboxInterval);
	clearInterval(workers.finalizerInterval);
	await workers.enrichWorker.close();
	await workers.executeWorker.close();
}

export async function handleEnrich(runId: string, logger?: Logger): Promise<void> {
	const workerId = `automation-enrich:${process.pid}`;
	const run = await runs.claimRun(runId, ["queued", "enriching"], workerId, LEASE_TTL_MS);
	if (!run) return;

	const log = logger?.child({
		runId,
		automationId: run.automationId,
		leaseOwner: workerId,
		leaseVersion: run.leaseVersion,
	});

	if (run.status !== "enriching") {
		await runs.transitionRunStatus(runId, "enriching", {
			enrichmentStartedAt: new Date(),
			lastActivityAt: new Date(),
		});
		log?.info({ fromStatus: run.status, toStatus: "enriching" }, "Run status transition");
	}

	const context = await runs.findRunWithRelations(runId);
	if (!context?.triggerEvent || !context.trigger || !context.automation) {
		log?.warn({ errorClass: "missing_context" }, "Enrichment aborted: missing context");
		await runs.markRunFailed({
			runId,
			reason: "missing_context",
			stage: "enrichment",
			errorMessage: "Missing automation, trigger, or trigger event context",
		});
		return;
	}

	try {
		const enrichment = buildEnrichmentPayload(context);

		// Atomic enrichment completion: persist payload, transition to ready,
		// and enqueue downstream outbox items in a single transaction.
		await runs.completeEnrichment({
			runId,
			organizationId: run.organizationId,
			enrichmentPayload: enrichment as unknown as Record<string, unknown>,
		});

		log?.info(
			{
				fromStatus: "enriching",
				toStatus: "ready",
				triggerEventId: context.triggerEvent.id,
			},
			"Enrichment completed (atomic)",
		);
	} catch (err) {
		log?.error({ err }, "Enrichment error");
		if (err instanceof EnrichmentError) {
			log?.warn(
				{ errorClass: "enrichment_failed", errorMessage: err.message },
				"Enrichment failed",
			);
			await runs.markRunFailed({
				runId,
				reason: "enrichment_failed",
				stage: "enrichment",
				errorMessage: err.message,
			});
			return;
		}
		throw err;
	}
}

async function handleExecute(
	runId: string,
	syncClient: SyncClient,
	logger?: Logger,
): Promise<void> {
	const workerId = `automation-execute:${process.pid}`;
	const run = await runs.claimRun(runId, ["ready"], workerId, LEASE_TTL_MS);
	if (!run) return;

	const log = logger?.child({
		runId,
		automationId: run.automationId,
		leaseOwner: workerId,
		leaseVersion: run.leaseVersion,
	});

	const context = await runs.findRunWithRelations(runId);
	if (!context || !context.automation || !context.triggerEvent) {
		log?.warn({ errorClass: "missing_context" }, "Execute aborted: missing context");
		await runs.markRunFailed({
			runId,
			reason: "missing_context",
			stage: "execution",
			errorMessage: "Missing automation or trigger event context",
		});
		return;
	}

	const automation = context.automation;

	const target = await resolveTarget({
		automation: context.automation,
		enrichmentJson: context.enrichmentJson,
		organizationId: run.organizationId,
	});

	await runs.insertRunEvent(runId, "target_resolved", run.status, run.status, {
		type: target.type,
		reason: target.reason,
		suggestedRepoId: target.suggestedRepoId ?? null,
		configurationId: target.configurationId ?? null,
		repoIds: target.repoIds ?? null,
	});

	const hasTarget =
		(target.type === "selected" && (target.repoIds?.length || target.configurationId)) ||
		(target.type !== "selected" && target.configurationId);

	if (!hasTarget) {
		log?.warn(
			{ errorClass: "missing_configuration", targetType: target.type },
			"Execute aborted: no valid target",
		);
		await runs.markRunFailed({
			runId,
			reason: "missing_configuration",
			stage: "execution",
			errorMessage: "Automation missing default configuration and no valid selection",
		});
		return;
	}

	await runs.transitionRunStatus(runId, "running", {
		executionStartedAt: new Date(),
		lastActivityAt: new Date(),
	});

	log?.info(
		{
			fromStatus: "ready",
			toStatus: "running",
			triggerEventId: context.triggerEvent.id,
			targetType: target.type,
			targetReason: target.reason,
		},
		"Run status transition",
	);

	let sessionId = run.sessionId ?? null;
	if (!sessionId) {
		const sessionRequest: Parameters<typeof syncClient.createSession>[0] = {
			organizationId: run.organizationId,
			sessionType: "coding",
			clientType: "automation",
			sandboxMode: "immediate",
			title: buildTitle(automation.name, context.triggerEvent.parsedContext),
			automationId: automation.id,
			triggerId: context.trigger?.id,
			triggerEventId: context.triggerEvent.id,
			triggerContext: context.triggerEvent.parsedContext as Record<string, unknown>,
			agentConfig: automation.modelId ? { modelId: automation.modelId } : undefined,
			clientMetadata: {
				automationId: automation.id,
				triggerId: context.trigger?.id,
				triggerEventId: context.triggerEvent.id,
				provider: context.trigger?.provider,
				context: context.triggerEvent.parsedContext,
				targetResolution: {
					type: target.type,
					reason: target.reason,
					suggestedRepoId: target.suggestedRepoId,
				},
			},
		};

		// agent_decide mode never creates managed configurations; it only
		// selects from existing ones. The repoIds path is kept only for
		// legacy non-agent_decide selection where strategy is "fixed".
		const strategy = automation.configSelectionStrategy ?? "fixed";
		if (target.type === "selected" && target.repoIds && strategy !== "agent_decide") {
			sessionRequest.managedConfiguration = { repoIds: target.repoIds };
		} else {
			sessionRequest.configurationId = target.configurationId;
		}

		const session = await syncClient.createSession(sessionRequest, {
			idempotencyKey: `run:${runId}:session`,
		});

		sessionId = session.sessionId;
		await runs.updateRun(runId, {
			sessionId,
			sessionCreatedAt: new Date(),
			lastActivityAt: new Date(),
		});

		await triggers.updateEvent(context.triggerEvent.id, {
			status: "processing",
			sessionId,
			processedAt: new Date(),
		});

		log?.info({ sessionId }, "Session created for run");
	}

	if (!run.promptSentAt) {
		const prompt = buildPrompt(automation.agentInstructions, runId);
		await syncClient.postMessage(sessionId, {
			content: prompt,
			userId: "automation",
			idempotencyKey: `run:${runId}:prompt:v1`,
		});
		await runs.updateRun(runId, {
			promptSentAt: new Date(),
			lastActivityAt: new Date(),
		});
		log?.info({ sessionId }, "Prompt sent to session");
	}
}

async function finalizeRuns(syncClient: SyncClient, logger: Logger): Promise<void> {
	const deps: FinalizerDeps = {
		getSessionStatus: (sessionId) => syncClient.getSessionStatus(sessionId),
		markRunFailed: (opts) => runs.markRunFailed(opts),
		transitionRunStatus: (runId, toStatus, updates) =>
			runs.transitionRunStatus(runId, toStatus, updates),
		updateTriggerEvent: (eventId, updates) => triggers.updateEvent(eventId, updates),
		enqueueNotification: (orgId, runId, status) =>
			notifications.enqueueRunNotification(orgId, runId, status),
		log: logger,
	};

	const candidates = await runs.listStaleRunningRuns({
		limit: 50,
		inactivityMs: INACTIVITY_MS,
	});

	for (const run of candidates) {
		try {
			await finalizeOneRun(run, deps);
		} catch (err) {
			logger.error({ err, runId: run.id }, "Failed to finalize run");
		}
	}
}

/** Exponential backoff: min(30s * 2^attempts, 5min) */
export function retryDelay(attempts: number): Date {
	const delayMs = Math.min(30_000 * 2 ** attempts, 5 * 60 * 1000);
	return new Date(Date.now() + delayMs);
}

export async function dispatchOutbox(
	enrichQueue: ReturnType<typeof createAutomationEnrichQueue>,
	executeQueue: ReturnType<typeof createAutomationExecuteQueue>,
	logger: Logger,
): Promise<void> {
	const recovered = await outbox.recoverStuckOutbox();
	if (recovered > 0) {
		logger.warn({ recovered }, "Recovered stuck outbox rows");
	}

	const claimed = await outbox.claimPendingOutbox(50);
	for (const item of claimed) {
		try {
			const payload = item.payload as { runId?: string };
			const runId = payload.runId;
			if (!runId) {
				await outbox.markFailed(item.id, "Missing runId in outbox payload");
				continue;
			}

			switch (item.kind) {
				case "enqueue_enrich":
					await queueAutomationEnrich(enrichQueue, runId);
					break;
				case "enqueue_execute":
					await queueAutomationExecute(executeQueue, runId);
					break;
				case "write_artifacts":
					await writeArtifacts(runId);
					break;
				case "notify_run_terminal":
					await dispatchRunNotification(runId, logger);
					break;
				case "notify_session_complete": {
					const sessionId = (item.payload as { sessionId?: string }).sessionId;
					if (!sessionId) {
						await outbox.markFailed(item.id, "Missing sessionId in outbox payload");
						continue;
					}
					await dispatchSessionNotification(sessionId, logger);
					break;
				}
				default:
					await outbox.markFailed(item.id, `Unknown outbox kind: ${item.kind}`);
					continue;
			}

			await outbox.markDispatched(item.id);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await outbox.markFailed(item.id, message, retryDelay(item.attempts));
		}
	}
}

async function writeArtifacts(runId: string): Promise<void> {
	const run = await runs.findRunWithRelations(runId);
	if (!run) {
		throw new Error("Run not found");
	}

	if (!run.completionJson && !run.enrichmentJson) {
		throw new Error("Run has no artifact payload to write");
	}

	if (run.completionJson) {
		const completionKey = await writeCompletionArtifact(runId, run.completionJson);
		await runs.updateRun(runId, { completionArtifactRef: completionKey });
	}

	if (run.enrichmentJson) {
		const enrichmentKey = await writeEnrichmentArtifact(runId, run.enrichmentJson);
		await runs.updateRun(runId, { enrichmentArtifactRef: enrichmentKey });
	}
}

function buildPrompt(instructions: string | null | undefined, runId: string): string {
	const parts: string[] = [];
	if (instructions?.trim()) {
		parts.push(instructions.trim());
	}
	parts.push("The trigger context is available at `.proliferate/trigger-context.json`");
	parts.push(
		[
			"Completion requirements:",
			"- You MUST call `automation.complete` when finished or blocked.",
			`- Use run_id: ${runId}`,
			`- Use completion_id: run:${runId}:completion:v1`,
			"- Set outcome to succeeded | failed | needs_human.",
			"- Include a concise summary_markdown and citations if applicable.",
		].join("\n"),
	);
	return parts.join("\n\n");
}

function buildTitle(name: string, context: unknown): string {
	const title = (context as { title?: string } | null)?.title;
	if (title) return `${name} · ${title}`;
	return name;
}
