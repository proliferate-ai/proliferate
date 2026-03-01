/**
 * Workers service.
 *
 * Business rules around worker lifecycle, wake/run orchestration, and run events.
 */

import {
	WORKER_RUN_EVENT_TYPES,
	type WorkerRunEventType,
	type WorkerRunStatus,
	type WorkerStatus,
	isValidWorkerRunTransition,
	isValidWorkerTransition,
} from "@proliferate/shared/contracts";
import type { WakeEventRow } from "../wakes/db";
import * as wakesDb from "../wakes/db";
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

function toWorkerStatus(status: string): WorkerStatus {
	return status as WorkerStatus;
}

function toWorkerRunStatus(status: string): WorkerRunStatus {
	return status as WorkerRunStatus;
}

export async function pauseWorker(
	workerId: string,
	organizationId: string,
	pausedBy?: string | null,
): Promise<WorkerRow> {
	const worker = await workersDb.findWorkerById(workerId, organizationId);
	if (!worker) {
		throw new WorkerNotFoundError(workerId);
	}

	const fromStatus = toWorkerStatus(worker.status);
	if (fromStatus === "paused") {
		return worker;
	}
	if (!isValidWorkerTransition(fromStatus, "paused")) {
		throw new WorkerStatusTransitionError(fromStatus, "paused");
	}

	const updated = await workersDb.transitionWorkerStatus(
		worker.id,
		organizationId,
		[fromStatus],
		"paused",
		{
			pausedAt: new Date(),
			pausedBy: pausedBy ?? null,
		},
	);
	if (!updated) {
		throw new Error("Worker pause failed due to concurrent state change");
	}

	return updated;
}

export async function resumeWorker(workerId: string, organizationId: string): Promise<WorkerRow> {
	const worker = await workersDb.findWorkerById(workerId, organizationId);
	if (!worker) {
		throw new WorkerNotFoundError(workerId);
	}

	const fromStatus = toWorkerStatus(worker.status);
	if (fromStatus === "active") {
		return worker;
	}
	if (!isValidWorkerTransition(fromStatus, "active")) {
		throw new WorkerStatusTransitionError(fromStatus, "active");
	}

	const updated = await workersDb.transitionWorkerStatus(
		worker.id,
		organizationId,
		[fromStatus],
		"active",
		{
			pausedAt: null,
			pausedBy: null,
		},
	);
	if (!updated) {
		throw new Error("Worker resume failed due to concurrent state change");
	}

	return updated;
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

	const status = toWorkerStatus(worker.status);
	if (status === "paused") {
		throw new WorkerResumeRequiredError(workerId);
	}
	if (status !== "active") {
		throw new WorkerStatusTransitionError(status, "active");
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
	return workersDb.claimNextWakeAndCreateRun(workerId, organizationId);
}

export async function startWorkerRun(
	workerRunId: string,
	organizationId: string,
): Promise<WorkerRunRow> {
	const workerRun = await workersDb.findWorkerRunById(workerRunId);
	if (!workerRun || workerRun.organizationId !== organizationId) {
		throw new WorkerRunNotFoundError(workerRunId);
	}

	const fromStatus = toWorkerRunStatus(workerRun.status);
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

	const fromStatus = toWorkerRunStatus(workerRun.status);
	if (!isValidWorkerRunTransition(fromStatus, "completed")) {
		throw new WorkerRunTransitionError(fromStatus, "completed");
	}

	const updated = await workersDb.transitionWorkerRunStatus(
		input.workerRunId,
		input.organizationId,
		[fromStatus],
		"completed",
		{
			summary: input.summary,
			completedAt: new Date(),
		},
	);
	if (!updated) {
		throw new Error("Worker run completion failed due to concurrent state change");
	}

	await appendWorkerRunEvent({
		workerRunId: updated.id,
		workerId: updated.workerId,
		eventType: "wake_completed",
		summaryText: input.summary,
		payloadJson: {
			result: input.result ?? "completed",
			summary: input.summary ?? null,
		},
	});

	return updated;
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

	const fromStatus = toWorkerRunStatus(workerRun.status);
	if (!isValidWorkerRunTransition(fromStatus, "failed")) {
		throw new WorkerRunTransitionError(fromStatus, "failed");
	}

	const updated = await workersDb.transitionWorkerRunStatus(
		input.workerRunId,
		input.organizationId,
		[fromStatus],
		"failed",
		{
			summary: input.errorCode,
			completedAt: new Date(),
		},
	);
	if (!updated) {
		throw new Error("Worker run failure update failed due to concurrent state change");
	}

	await appendWorkerRunEvent({
		workerRunId: updated.id,
		workerId: updated.workerId,
		eventType: "wake_failed",
		payloadJson: {
			errorCode: input.errorCode,
			errorMessage: input.errorMessage ?? null,
			retryable: input.retryable ?? false,
		},
	});

	return updated;
}

export async function appendWorkerRunEvent(
	input: AppendWorkerRunEventInput,
): Promise<WorkerRunEventRow> {
	if (!WORKER_RUN_EVENT_TYPES_SET.has(input.eventType)) {
		throw new WorkerRunEventTypeError(input.eventType);
	}

	if (input.dedupeKey) {
		const existing = await workersDb.findWorkerRunEventByDedupeKey(
			input.workerRunId,
			input.dedupeKey,
		);
		if (existing) {
			return existing;
		}
	}

	const eventIndex = await workersDb.getNextWorkerRunEventIndex(input.workerRunId);
	return workersDb.createWorkerRunEvent({
		workerRunId: input.workerRunId,
		workerId: input.workerId,
		eventIndex,
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
