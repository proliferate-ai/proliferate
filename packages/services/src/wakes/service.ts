/**
 * Wake Events service.
 *
 * Business rules around wake status transitions and queue operations.
 */

import {
	type WakeEventStatus,
	isTerminalWakeEventStatus,
	isValidWakeEventTransition,
} from "@proliferate/shared/contracts";
import type { CreateWakeEventInput, WakeEventRow } from "./db";
import * as wakesDb from "./db";

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
