/**
 * Workers service.
 *
 * Business rules around worker lifecycle, wake/run orchestration, and run events.
 */

import {
	WORKER_RUN_EVENT_TYPES,
	type WorkerRunEventType,
	type WorkerStatus,
	isValidWorkerRunTransition,
	isValidWorkerTransition,
} from "@proliferate/shared/contracts";
import * as sessionsDb from "../sessions/db";
import type { WakeEventRow } from "../wakes/db";
import * as wakesDb from "../wakes/db";
import { buildMergedWakePayload, extractWakeDedupeKey } from "../wakes/mapper";
import type { WorkerRow, WorkerRunEventRow, WorkerRunRow } from "./db";
import * as workersDb from "./db";

const WORKER_RUN_EVENT_TYPES_SET = new Set<string>(WORKER_RUN_EVENT_TYPES);

export class WorkerNotFoundError extends Error {
	constructor(workerId: string) {
		super(`Worker not found: ${workerId}`);
	}
}

export class WorkerStatusTransitionError extends Error {
	constructor(fromStatus: string, toStatus: string) {
		super(`Invalid worker transition: ${fromStatus} -> ${toStatus}`);
	}
}

export class WorkerResumeRequiredError extends Error {
	readonly code = "resume_required";

	constructor(workerId: string) {
		super(`Worker ${workerId} is paused and must be resumed before running now`);
	}
}

export class WorkerNotActiveError extends Error {
	constructor(workerId: string, status: string) {
		super(`Worker ${workerId} must be active to run now (current: ${status})`);
	}
}

export class WorkerRunNotFoundError extends Error {
	constructor(workerRunId: string) {
		super(`Worker run not found: ${workerRunId}`);
	}
}

export class WorkerRunTransitionError extends Error {
	constructor(fromStatus: string, toStatus: string) {
		super(`Invalid worker run transition: ${fromStatus} -> ${toStatus}`);
	}
}

export class WorkerRunEventTypeError extends Error {
	constructor(eventType: string) {
		super(`Invalid worker run event type: ${eventType}`);
	}
}

export interface RunNowResult {
	status: "queued";
	wakeEvent: WakeEventRow;
}

export interface AppendWorkerRunEventInput {
	workerRunId: string;
	workerId: string;
	eventType: WorkerRunEventType;
	summaryText?: string;
	payloadJson?: unknown;
	payloadVersion?: number;
	sessionId?: string;
	actionInvocationId?: string;
	dedupeKey?: string;
}

async function transitionWorker(
	workerId: string,
	organizationId: string,
	toStatus: WorkerStatus,
	idempotentFrom: WorkerStatus,
	fields?: { pausedAt?: Date | null; pausedBy?: string | null },
): Promise<WorkerRow> {
	const worker = await workersDb.findWorkerById(workerId, organizationId);
	if (!worker) throw new WorkerNotFoundError(workerId);

	if (worker.status === idempotentFrom) return worker;

	if (!isValidWorkerTransition(worker.status, toStatus)) {
		throw new WorkerStatusTransitionError(worker.status, toStatus);
	}

	const updated = await workersDb.transitionWorkerStatus(
		worker.id,
		organizationId,
		[worker.status],
		toStatus,
		fields,
	);
	if (!updated) {
		throw new Error(`Worker ${toStatus} failed due to concurrent state change`);
	}
	return updated;
}

export async function pauseWorker(
	workerId: string,
	organizationId: string,
	pausedBy?: string | null,
): Promise<WorkerRow> {
	return transitionWorker(workerId, organizationId, "paused", "paused", {
		pausedAt: new Date(),
		pausedBy: pausedBy ?? null,
	});
}

export async function resumeWorker(workerId: string, organizationId: string): Promise<WorkerRow> {
	return transitionWorker(workerId, organizationId, "active", "active", {
		pausedAt: null,
		pausedBy: null,
	});
}

export async function runNow(
	workerId: string,
	organizationId: string,
	payloadJson?: unknown,
): Promise<RunNowResult> {
	const worker = await workersDb.findWorkerById(workerId, organizationId);
	if (!worker) {
		throw new WorkerNotFoundError(workerId);
	}

	const status = worker.status;
	if (status === "paused") {
		throw new WorkerResumeRequiredError(workerId);
	}
	if (status !== "active") {
		throw new WorkerNotActiveError(workerId, status);
	}

	const wakeEvent = await wakesDb.createWakeEvent({
		workerId,
		organizationId,
		source: "manual",
		payloadJson: payloadJson ?? null,
	});

	return {
		status: "queued",
		wakeEvent,
	};
}

export async function orchestrateNextWakeAndCreateRun(
	workerId: string,
	organizationId: string,
): Promise<workersDb.ClaimNextWakeAndCreateRunResult | null> {
	return workersDb.withTransaction(async (tx) => {
		// Gating: worker must be active
		const worker = await workersDb.findWorkerForClaim(tx, workerId, organizationId);
		if (!worker || worker.status !== "active") return null;

		// Gating: no active run
		if (await workersDb.hasActiveWorkerRun(tx, workerId, organizationId)) return null;

		// Claim highest-priority queued wake
		const claimedWakeId = await workersDb.claimNextQueuedWakeEvent(tx, workerId, organizationId);
		if (!claimedWakeId) return null;

		const claimedWakeRow = await workersDb.fetchWakeEventRow(tx, claimedWakeId, organizationId);
		if (!claimedWakeRow) return null;
		let claimedWake = claimedWakeRow;

		// Coalescing: merge same-source queued wakes into the claimed wake
		const coalescedRows: workersDb.WakeEventRow[] = [];
		if (
			workersDb.COALESCEABLE_WAKE_SOURCES.includes(
				claimedWake.source as (typeof workersDb.COALESCEABLE_WAKE_SOURCES)[number],
			)
		) {
			const queuedSameSource = await workersDb.findQueuedWakesBySource(
				tx,
				workerId,
				organizationId,
				claimedWake.source,
			);

			const wakeDedupeKey = extractWakeDedupeKey(claimedWake.payloadJson);
			const candidates =
				claimedWake.source === "webhook"
					? wakeDedupeKey
						? queuedSameSource.filter(
								(row) => extractWakeDedupeKey(row.payloadJson) === wakeDedupeKey,
							)
						: []
					: queuedSameSource;

			const candidateIds = candidates.map((candidate) => candidate.id);
			if (candidateIds.length > 0) {
				const updatedRows = await workersDb.bulkCoalesceWakeEvents(
					tx,
					candidateIds,
					organizationId,
					claimedWake.id,
				);
				coalescedRows.push(...updatedRows);
			}

			if (coalescedRows.length > 0) {
				const updatedWake = await workersDb.updateWakeEventPayload(
					tx,
					claimedWake.id,
					organizationId,
					buildMergedWakePayload(claimedWake.payloadJson, coalescedRows),
				);
				if (updatedWake) {
					claimedWake = updatedWake;
				}
			}
		}

		// Create worker run
		const workerRun = await workersDb.insertWorkerRun(tx, {
			workerId: worker.id,
			organizationId: worker.organizationId,
			managerSessionId: worker.managerSessionId,
			wakeEventId: claimedWake.id,
		});

		// Consume the wake event
		const consumedWake = await workersDb.consumeWakeEvent(tx, claimedWake.id, organizationId);
		if (!consumedWake) {
			throw new Error("Failed to mark claimed wake as consumed");
		}

		// Touch worker last wake timestamp
		await workersDb.touchWorkerLastWake(tx, worker.id, organizationId);

		// Create wake_started event
		const wakeStartedEvent = await workersDb.insertWakeStartedEvent(tx, workerRun.id, worker.id, {
			wakeEventId: consumedWake.id,
			source: consumedWake.source,
			coalescedWakeEventIds: coalescedRows.map((row) => row.id),
		});

		return {
			worker,
			wakeEvent: consumedWake,
			workerRun,
			wakeStartedEvent,
			coalescedWakeEventIds: coalescedRows.map((row) => row.id),
		};
	});
}

export async function startWorkerRun(
	workerRunId: string,
	organizationId: string,
): Promise<WorkerRunRow> {
	const workerRun = await workersDb.findWorkerRunById(workerRunId);
	if (!workerRun || workerRun.organizationId !== organizationId) {
		throw new WorkerRunNotFoundError(workerRunId);
	}

	const fromStatus = workerRun.status;
	if (!isValidWorkerRunTransition(fromStatus, "running")) {
		throw new WorkerRunTransitionError(fromStatus, "running");
	}

	const updated = await workersDb.transitionWorkerRunStatus(
		workerRunId,
		organizationId,
		[fromStatus],
		"running",
		{ startedAt: new Date() },
	);
	if (!updated) {
		throw new Error("Worker run start failed due to concurrent state change");
	}
	return updated;
}

export async function completeWorkerRun(input: {
	workerRunId: string;
	organizationId: string;
	summary?: string;
	result?: string;
}): Promise<WorkerRunRow> {
	const workerRun = await workersDb.findWorkerRunById(input.workerRunId);
	if (!workerRun || workerRun.organizationId !== input.organizationId) {
		throw new WorkerRunNotFoundError(input.workerRunId);
	}

	const fromStatus = workerRun.status;
	if (!isValidWorkerRunTransition(fromStatus, "completed")) {
		throw new WorkerRunTransitionError(fromStatus, "completed");
	}

	const terminal = await workersDb.transitionWorkerRunWithTerminalEvent({
		workerRunId: input.workerRunId,
		organizationId: input.organizationId,
		fromStatuses: [fromStatus],
		toStatus: "completed",
		summary: input.summary,
		completedAt: new Date(),
		eventType: "wake_completed",
		eventSummaryText: input.summary,
		eventPayloadJson: {
			result: input.result ?? "completed",
			summary: input.summary ?? null,
		},
	});
	if (!terminal) {
		throw new Error("Worker run completion failed due to concurrent state change");
	}
	return terminal.workerRun;
}

export async function failWorkerRun(input: {
	workerRunId: string;
	organizationId: string;
	errorCode: string;
	errorMessage?: string;
	retryable?: boolean;
}): Promise<WorkerRunRow> {
	const workerRun = await workersDb.findWorkerRunById(input.workerRunId);
	if (!workerRun || workerRun.organizationId !== input.organizationId) {
		throw new WorkerRunNotFoundError(input.workerRunId);
	}

	const fromStatus = workerRun.status;
	if (!isValidWorkerRunTransition(fromStatus, "failed")) {
		throw new WorkerRunTransitionError(fromStatus, "failed");
	}

	const terminal = await workersDb.transitionWorkerRunWithTerminalEvent({
		workerRunId: input.workerRunId,
		organizationId: input.organizationId,
		fromStatuses: [fromStatus],
		toStatus: "failed",
		summary: input.errorCode,
		completedAt: new Date(),
		eventType: "wake_failed",
		eventPayloadJson: {
			errorCode: input.errorCode,
			errorMessage: input.errorMessage ?? null,
			retryable: input.retryable ?? false,
		},
	});
	if (!terminal) {
		throw new Error("Worker run failure update failed due to concurrent state change");
	}

	// If retryable, create a new wake event so the worker will be retried
	if (input.retryable) {
		await wakesDb.createWakeEvent({
			workerId: workerRun.workerId,
			organizationId: input.organizationId,
			source: "manual",
			payloadJson: {
				retryOfRunId: input.workerRunId,
				errorCode: input.errorCode,
			},
		});
	}

	return terminal.workerRun;
}

export async function appendWorkerRunEvent(
	input: AppendWorkerRunEventInput,
): Promise<WorkerRunEventRow> {
	if (!WORKER_RUN_EVENT_TYPES_SET.has(input.eventType)) {
		throw new WorkerRunEventTypeError(input.eventType);
	}
	return workersDb.appendWorkerRunEventAtomic({
		workerRunId: input.workerRunId,
		workerId: input.workerId,
		eventType: input.eventType,
		summaryText: input.summaryText,
		payloadJson: input.payloadJson,
		payloadVersion: input.payloadVersion,
		sessionId: input.sessionId,
		actionInvocationId: input.actionInvocationId,
		dedupeKey: input.dedupeKey,
	});
}

export async function listWorkerRunEvents(workerRunId: string): Promise<WorkerRunEventRow[]> {
	return workersDb.listEventsByRun(workerRunId);
}

export async function sendDirective(input: {
	managerSessionId: string;
	content: string;
	senderUserId: string;
}): Promise<{ messageId: string }> {
	const message = await sessionsDb.enqueueSessionMessage({
		sessionId: input.managerSessionId,
		direction: "user_to_manager",
		messageType: "directive",
		payloadJson: { content: input.content },
		senderUserId: input.senderUserId,
	});
	return { messageId: message.id };
}
