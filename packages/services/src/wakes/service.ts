/**
 * Wake Events service.
 *
 * Business rules around wake status transitions and queue operations.
 */

import {
	type WakeEventSource,
	type WakeEventStatus,
	isTerminalWakeEventStatus,
	isValidWakeEventTransition,
} from "@proliferate/shared/contracts/workers";
import type { CreateWakeEventInput, WakeEventRow } from "./db";
import * as wakesDb from "./db";

export type { WakeEventRow, CreateWakeEventInput } from "./db";

export class WakeNotFoundError extends Error {
	constructor(wakeEventId: string) {
		super(`Wake event not found: ${wakeEventId}`);
	}
}

export class WakeTransitionError extends Error {
	constructor(fromStatus: string, toStatus: string) {
		super(`Invalid wake event transition: ${fromStatus} -> ${toStatus}`);
	}
}

export async function enqueueWake(input: CreateWakeEventInput): Promise<WakeEventRow> {
	return wakesDb.createWakeEvent(input);
}

/**
 * Create a new wake event. Thin wrapper over DB.
 */
export async function createWakeEvent(input: CreateWakeEventInput): Promise<WakeEventRow> {
	return wakesDb.createWakeEvent(input);
}

/**
 * Find a wake event by ID and organization.
 */
export async function findWakeEventById(
	id: string,
	organizationId: string,
): Promise<WakeEventRow | undefined> {
	return wakesDb.findWakeEventById(id, organizationId);
}

/**
 * Check if a worker has any queued wake event with the given source.
 */
export async function hasQueuedWakeBySource(
	workerId: string,
	source: WakeEventSource,
): Promise<boolean> {
	return wakesDb.hasQueuedWakeBySource(workerId, source);
}

/**
 * List queued wake events for a worker, ordered by priority and time.
 */
export async function listQueuedByWorker(
	workerId: string,
	organizationId: string,
): Promise<WakeEventRow[]> {
	return wakesDb.listQueuedByWorker(workerId, organizationId);
}

/**
 * List queued wake events for a worker filtered by source.
 */
export async function listQueuedByWorkerAndSource(
	workerId: string,
	organizationId: string,
	source: WakeEventSource,
): Promise<WakeEventRow[]> {
	return wakesDb.listQueuedByWorkerAndSource(workerId, organizationId, source);
}

/**
 * List recent wake events for a worker.
 */
export async function listByWorker(
	workerId: string,
	organizationId: string,
	limit?: number,
): Promise<WakeEventRow[]> {
	return wakesDb.listByWorker(workerId, organizationId, limit);
}

export async function transitionWakeStatus(input: {
	wakeEventId: string;
	organizationId: string;
	toStatus: WakeEventStatus;
	fields?: {
		coalescedIntoWakeEventId?: string | null;
		claimedAt?: Date | null;
		consumedAt?: Date | null;
		failedAt?: Date | null;
	};
}): Promise<WakeEventRow> {
	const wake = await wakesDb.findWakeEventById(input.wakeEventId, input.organizationId);
	if (!wake) {
		throw new WakeNotFoundError(input.wakeEventId);
	}

	const fromStatus = wake.status;
	if (!isValidWakeEventTransition(fromStatus, input.toStatus)) {
		throw new WakeTransitionError(fromStatus, input.toStatus);
	}

	const updated = await wakesDb.transitionWakeEventStatus({
		id: input.wakeEventId,
		organizationId: input.organizationId,
		fromStatuses: [fromStatus],
		toStatus: input.toStatus,
		fields: input.fields,
	});

	if (!updated) {
		throw new Error("Wake status transition failed due to concurrent update");
	}

	return updated;
}

export async function cancelQueuedWake(
	wakeEventId: string,
	organizationId: string,
): Promise<WakeEventRow> {
	return transitionWakeStatus({
		wakeEventId,
		organizationId,
		toStatus: "cancelled",
	});
}

export async function failClaimedWake(
	wakeEventId: string,
	organizationId: string,
): Promise<WakeEventRow> {
	return transitionWakeStatus({
		wakeEventId,
		organizationId,
		toStatus: "failed",
		fields: {
			failedAt: new Date(),
		},
	});
}

export async function isTerminalWake(
	wakeEventId: string,
	organizationId: string,
): Promise<boolean> {
	const wake = await wakesDb.findWakeEventById(wakeEventId, organizationId);
	if (!wake) return false;
	return isTerminalWakeEventStatus(wake.status);
}
