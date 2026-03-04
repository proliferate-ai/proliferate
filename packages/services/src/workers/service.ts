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
} from "@proliferate/shared/contracts/workers";
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

export interface WorkerDetail {
	id: string;
	name: string;
	status: string;
	objective: string | null;
	modelId: string | null;
	managerSessionId: string;
	lastWakeAt: Date | null;
	lastCompletedRunAt: Date | null;
	lastErrorCode: string | null;
	pausedAt: Date | null;
	createdBy: string | null;
	computeProfile: string | null;
	pausedBy: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface WorkerListEntry extends WorkerDetail {
	activeTaskCount: number;
	pendingApprovalCount: number;
}

export interface WorkerRunListItem {
	id: string;
	workerId: string;
	status: string;
	summary: string | null;
	wakeEventId: string;
	createdAt: Date;
	startedAt: Date | null;
	completedAt: Date | null;
	events: Array<{
		id: string;
		eventIndex: number;
		eventType: string;
		summaryText: string | null;
		payloadJson: unknown;
		sessionId: string | null;
		actionInvocationId: string | null;
		createdAt: Date;
	}>;
}

export interface WorkerSessionListItem {
	id: string;
	title: string | null;
	status: string | null;
	repoId: string | null;
	branchName: string | null;
	operatorStatus: string;
	updatedAt: Date | null;
	startedAt: Date | null;
}

export interface PendingDirectiveItem {
	id: string;
	messageType: string;
	payloadJson: unknown;
	queuedAt: Date;
	senderUserId: string | null;
}

function toWorkerDetail(worker: WorkerRow): WorkerDetail {
	return {
		id: worker.id,
		name: worker.name,
		status: worker.status,
		objective: worker.objective,
		modelId: worker.modelId,
		managerSessionId: worker.managerSessionId,
		lastWakeAt: worker.lastWakeAt,
		lastCompletedRunAt: worker.lastCompletedRunAt,
		lastErrorCode: worker.lastErrorCode,
		pausedAt: worker.pausedAt,
		createdBy: worker.createdBy,
		computeProfile: worker.computeProfile,
		pausedBy: worker.pausedBy,
		createdAt: worker.createdAt,
		updatedAt: worker.updatedAt,
	};
}

function toWorkerWithCounts(worker: workersDb.WorkerRowWithCounts): WorkerListEntry {
	return {
		id: worker.id,
		name: worker.name,
		status: worker.status,
		objective: worker.objective,
		modelId: worker.modelId,
		managerSessionId: worker.managerSessionId,
		lastWakeAt: worker.lastWakeAt,
		lastCompletedRunAt: worker.lastCompletedRunAt,
		lastErrorCode: worker.lastErrorCode,
		pausedAt: worker.pausedAt,
		createdBy: worker.createdBy,
		computeProfile: worker.computeProfile,
		pausedBy: worker.pausedBy,
		createdAt: worker.createdAt,
		updatedAt: worker.updatedAt,
		activeTaskCount: worker.activeTaskCount,
		pendingApprovalCount: worker.pendingApprovalCount,
	};
}

export async function createWorkerWithManagerSession(input: {
	organizationId: string;
	createdBy: string;
	name?: string;
	objective?: string;
	modelId?: string;
	repoId?: string;
	configurationId?: string;
}): Promise<WorkerDetail> {
	const name = input.name || "Untitled coworker";

	const worker = await workersDb.withTransaction(async (tx) => {
		const placeholderSession = await sessionsDb.createManagerSessionPlaceholder(
			{
				organizationId: input.organizationId,
				createdBy: input.createdBy,
				repoId: input.repoId,
				configurationId: input.configurationId,
				visibility: "org",
				title: `Manager: ${name}`,
			},
			tx,
		);

		const createdWorker = await workersDb.createWorker(
			{
				organizationId: input.organizationId,
				name,
				objective: input.objective,
				managerSessionId: placeholderSession.id,
				modelId: input.modelId,
				createdBy: input.createdBy,
			},
			tx,
		);

		await sessionsDb.promoteToManagerSession(placeholderSession.id, createdWorker.id, tx);
		return createdWorker;
	});

	return toWorkerDetail(worker);
}

export async function listWorkersForOrg(orgId: string): Promise<WorkerListEntry[]> {
	const workers = await workersDb.listWorkersByOrgWithCounts(orgId);
	return workers.map((worker) => toWorkerWithCounts(worker));
}

export async function getWorkerForOrgWithCounts(
	workerId: string,
	orgId: string,
): Promise<WorkerListEntry> {
	const workers = await listWorkersForOrg(orgId);
	const worker = workers.find((entry) => entry.id === workerId);
	if (!worker) {
		throw new WorkerNotFoundError(workerId);
	}
	return worker;
}

export async function getWorkerForOrg(
	workerId: string,
	organizationId: string,
): Promise<WorkerRow> {
	const worker = await workersDb.findWorkerById(workerId, organizationId);
	if (!worker) {
		throw new WorkerNotFoundError(workerId);
	}
	return worker;
}

/**
 * Service-owned compatibility wrapper for optional worker lookups.
 * Prefer getWorkerForOrg() for strict existence checks.
 */
export async function findWorkerById(
	workerId: string,
	organizationId: string,
): Promise<WorkerRow | undefined> {
	return workersDb.findWorkerById(workerId, organizationId);
}

/**
 * Service-owned wrapper used by manager harness wake-cycle orchestration.
 */
export async function findActiveRunByWorker(
	workerId: string,
	organizationId: string,
): Promise<WorkerRunRow | undefined> {
	return workersDb.findActiveRunByWorker(workerId, organizationId);
}

/**
 * Service-owned wrapper used by tick scheduling and sweeps.
 */
export async function listActiveWorkers(): Promise<WorkerRow[]> {
	return workersDb.listActiveWorkers();
}

export async function listWorkerRunsForOrg(
	workerId: string,
	organizationId: string,
	limit?: number,
): Promise<WorkerRunListItem[]> {
	await getWorkerForOrg(workerId, organizationId);
	const runs = await workersDb.listRunsByWorkerWithEvents(workerId, limit);
	return runs.map((run) => ({
		id: run.id,
		workerId: run.workerId,
		status: run.status,
		summary: run.summary,
		wakeEventId: run.wakeEventId,
		createdAt: run.createdAt,
		startedAt: run.startedAt,
		completedAt: run.completedAt,
		events: run.events.map((event) => ({
			id: event.id,
			eventIndex: event.eventIndex,
			eventType: event.eventType,
			summaryText: event.summaryText,
			payloadJson: event.payloadJson,
			sessionId: event.sessionId,
			actionInvocationId: event.actionInvocationId,
			createdAt: event.createdAt,
		})),
	}));
}

export async function listWorkerSessionsForOrg(
	workerId: string,
	organizationId: string,
	limit?: number,
): Promise<WorkerSessionListItem[]> {
	await getWorkerForOrg(workerId, organizationId);
	const sessions = await workersDb.listSessionsByWorker(workerId, organizationId, limit);
	return sessions.map((session) => ({
		id: session.id,
		title: session.title,
		status: session.status,
		repoId: session.repoId,
		branchName: session.branchName,
		operatorStatus: session.operatorStatus,
		updatedAt: session.lastActivityAt,
		startedAt: session.startedAt,
	}));
}

export async function listPendingDirectivesForOrg(
	workerId: string,
	organizationId: string,
): Promise<PendingDirectiveItem[]> {
	const worker = await getWorkerForOrg(workerId, organizationId);
	const messages = await workersDb.listPendingDirectives(worker.managerSessionId);
	return messages.map((message) => ({
		id: message.id,
		messageType: message.messageType,
		payloadJson: message.payloadJson,
		queuedAt: message.queuedAt,
		senderUserId: message.senderUserId,
	}));
}

/**
 * Service-owned wrapper for manager-session directive queue reads.
 */
export async function listPendingDirectives(
	managerSessionId: string,
): Promise<PendingDirectiveItem[]> {
	const messages = await workersDb.listPendingDirectives(managerSessionId);
	return messages.map((message) => ({
		id: message.id,
		messageType: message.messageType,
		payloadJson: message.payloadJson,
		queuedAt: message.queuedAt,
		senderUserId: message.senderUserId,
	}));
}

export async function sendDirectiveToWorker(input: {
	workerId: string;
	organizationId: string;
	senderUserId: string;
	content: string;
}): Promise<{ messageId: string }> {
	const worker = await getWorkerForOrg(input.workerId, input.organizationId);
	const { messageId } = await sendDirective({
		managerSessionId: worker.managerSessionId,
		content: input.content,
		senderUserId: input.senderUserId,
	});

	if (worker.status === "active") {
		try {
			await wakesDb.createWakeEvent({
				workerId: worker.id,
				organizationId: input.organizationId,
				source: "manual_message",
				payloadJson: { messageId },
			});
		} catch {
			// Best effort: directive remains queued even if wake creation fails.
		}
	}

	return { messageId };
}

export async function pauseWorkerForOrg(
	workerId: string,
	organizationId: string,
	pausedBy?: string | null,
): Promise<WorkerDetail> {
	const worker = await pauseWorker(workerId, organizationId, pausedBy);
	return toWorkerDetail(worker);
}

export async function resumeWorkerForOrg(
	workerId: string,
	organizationId: string,
): Promise<WorkerDetail> {
	const worker = await resumeWorker(workerId, organizationId);
	return toWorkerDetail(worker);
}

export async function updateWorkerForOrg(input: {
	workerId: string;
	organizationId: string;
	fields: {
		name?: string;
		objective?: string;
		modelId?: string;
	};
	repoId?: string | null;
	configurationId?: string | null;
}): Promise<WorkerDetail | null> {
	const updated = await workersDb.updateWorker(input.workerId, input.organizationId, input.fields);
	if (!updated) {
		return null;
	}

	if (input.repoId !== undefined || input.configurationId !== undefined) {
		await sessionsDb.updateManagerSessionLinkage(updated.managerSessionId, input.organizationId, {
			repoId: input.repoId ?? null,
			configurationId: input.configurationId ?? null,
		});
	}

	return toWorkerDetail(updated);
}

/**
 * Service-owned wrapper for worker deletion.
 */
export async function deleteWorker(id: string, orgId: string): Promise<boolean> {
	return workersDb.deleteWorker(id, orgId);
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
