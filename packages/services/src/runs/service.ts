/**
 * Automation runs service.
 */

import {
	and,
	automationRunEvents,
	automationRuns,
	eq,
	inArray,
	outbox,
	triggerEvents,
} from "../db/client";
import { getDb } from "../db/client";
import { enqueueRunNotification } from "../notifications/service";
import type { TriggerEventRow } from "../triggers/db";
import * as runsDb from "./db";
import { validateTransition } from "./state-machine";

/** Default run deadline: 2 hours from creation. */
export const DEFAULT_RUN_DEADLINE_MS = 2 * 60 * 60 * 1000;

export class RunAlreadyAssignedError extends Error {
	readonly assignedTo: string;

	constructor(assignedTo: string) {
		super("Run is already assigned");
		this.assignedTo = assignedTo;
	}
}

export interface CreateRunFromTriggerEventInput {
	triggerId: string;
	organizationId: string;
	automationId: string;
	externalEventId: string | null;
	providerEventType: string | null;
	rawPayload: Record<string, unknown>;
	parsedContext: Record<string, unknown> | null;
	dedupKey: string | null;
	/** Override deadline TTL in milliseconds. Defaults to DEFAULT_RUN_DEADLINE_MS. */
	deadlineTtlMs?: number;
}

export interface CreateRunFromTriggerEventResult {
	run: runsDb.AutomationRunRow;
	event: TriggerEventRow;
}

export async function createRunFromTriggerEvent(
	input: CreateRunFromTriggerEventInput,
): Promise<CreateRunFromTriggerEventResult> {
	const db = getDb();

	const deadlineTtlMs = input.deadlineTtlMs ?? DEFAULT_RUN_DEADLINE_MS;

	return db.transaction(async (tx) => {
		const [event] = await tx
			.insert(triggerEvents)
			.values({
				triggerId: input.triggerId,
				organizationId: input.organizationId,
				externalEventId: input.externalEventId,
				providerEventType: input.providerEventType,
				rawPayload: input.rawPayload,
				parsedContext: input.parsedContext,
				dedupKey: input.dedupKey,
				status: "queued",
			})
			.returning();

		const now = new Date();
		const [run] = await tx
			.insert(automationRuns)
			.values({
				organizationId: input.organizationId,
				automationId: input.automationId,
				triggerEventId: event.id,
				triggerId: input.triggerId,
				status: "queued",
				deadlineAt: new Date(now.getTime() + deadlineTtlMs),
			})
			.returning();

		await tx.insert(outbox).values({
			organizationId: input.organizationId,
			kind: "enqueue_enrich",
			payload: { runId: run.id },
		});

		return { event: event as TriggerEventRow, run };
	});
}

export async function claimRun(
	runId: string,
	allowedStatuses: string[],
	leaseOwner: string,
	leaseTtlMs: number,
): Promise<runsDb.AutomationRunRow | null> {
	return runsDb.claimRun(runId, allowedStatuses, leaseOwner, leaseTtlMs);
}

export async function updateRun(
	runId: string,
	updates: Partial<runsDb.AutomationRunRow>,
): Promise<runsDb.AutomationRunRow | null> {
	return runsDb.updateRun(runId, updates);
}

export async function insertRunEvent(
	runId: string,
	type: string,
	fromStatus?: string | null,
	toStatus?: string | null,
	data?: Record<string, unknown> | null,
): Promise<runsDb.AutomationRunEventRow> {
	return runsDb.insertRunEvent(runId, type, fromStatus, toStatus, data);
}

export async function transitionRunStatus(
	runId: string,
	toStatus: string,
	updates?: Partial<runsDb.AutomationRunRow>,
	data?: Record<string, unknown> | null,
): Promise<runsDb.AutomationRunRow | null> {
	const run = await runsDb.findById(runId);
	if (!run) return null;
	validateTransition(run.status, toStatus);
	const fromStatus = run.status ?? null;
	const updated = await runsDb.updateRun(runId, { status: toStatus, ...updates });
	await runsDb.insertRunEvent(runId, "status_transition", fromStatus, toStatus, data ?? null);
	return updated;
}

export async function markRunFailed(options: {
	runId: string;
	reason: string;
	stage: string;
	errorMessage?: string;
	data?: Record<string, unknown> | null;
}): Promise<runsDb.AutomationRunRow | null> {
	const updated = await transitionRunStatus(
		options.runId,
		"failed",
		{
			statusReason: options.reason,
			failureStage: options.stage,
			errorMessage: options.errorMessage,
			completedAt: new Date(),
		},
		options.data ?? null,
	);

	if (updated) {
		try {
			await enqueueRunNotification(updated.organizationId, options.runId, "failed");
		} catch {
			// Non-critical: don't let notification failures break callers
		}
	}

	return updated;
}

export async function findRunWithRelations(
	runId: string,
): Promise<runsDb.AutomationRunWithRelations | null> {
	return runsDb.findByIdWithRelations(runId);
}

export async function listStaleRunningRuns(options: {
	limit?: number;
	inactivityMs: number;
	now?: Date;
}): Promise<runsDb.AutomationRunRow[]> {
	return runsDb.listStaleRunningRuns(options);
}

export interface CompleteRunInput {
	runId: string;
	completionId: string;
	outcome: "succeeded" | "failed" | "needs_human";
	completionJson: Record<string, unknown>;
	sessionId?: string;
}

// ============================================
// Enrichment persistence
// ============================================

export interface SaveEnrichmentResultInput {
	runId: string;
	enrichmentPayload: Record<string, unknown>;
}

export async function saveEnrichmentResult(
	input: SaveEnrichmentResultInput,
): Promise<runsDb.AutomationRunRow | null> {
	const run = await runsDb.findById(input.runId);
	if (!run) return null;

	const updated = await runsDb.updateRun(input.runId, {
		enrichmentJson: input.enrichmentPayload,
	});

	await runsDb.insertRunEvent(input.runId, "enrichment_saved", run.status, run.status, {
		payloadSize: JSON.stringify(input.enrichmentPayload).length,
	});

	return updated;
}

/**
 * Atomically complete enrichment: persist payload, transition to "ready",
 * and enqueue downstream outbox items in a single transaction.
 *
 * This replaces the sequential writes in handleEnrich to eliminate
 * the inconsistency window between enrichment save and status transition.
 */
export interface CompleteEnrichmentInput {
	runId: string;
	organizationId: string;
	enrichmentPayload: Record<string, unknown>;
}

export async function completeEnrichment(
	input: CompleteEnrichmentInput,
): Promise<runsDb.AutomationRunRow | null> {
	const db = getDb();

	return db.transaction(async (tx) => {
		const run = await tx.query.automationRuns.findFirst({
			where: eq(automationRuns.id, input.runId),
		});
		if (!run) return null;
		validateTransition(run.status, "ready");

		const now = new Date();

		// 1. Persist enrichment + transition to ready
		const [updated] = await tx
			.update(automationRuns)
			.set({
				enrichmentJson: input.enrichmentPayload,
				status: "ready",
				enrichmentCompletedAt: now,
				lastActivityAt: now,
				updatedAt: now,
			})
			.where(and(eq(automationRuns.id, input.runId), eq(automationRuns.status, run.status)))
			.returning();
		if (!updated) {
			throw new Error("Run status changed during enrichment completion");
		}

		// 2. Record enrichment_saved event
		await tx.insert(automationRunEvents).values({
			runId: input.runId,
			type: "enrichment_saved",
			fromStatus: run.status ?? null,
			toStatus: run.status ?? null,
			data: { payloadSize: JSON.stringify(input.enrichmentPayload).length },
		});

		// 3. Record status transition event
		await tx.insert(automationRunEvents).values({
			runId: input.runId,
			type: "status_transition",
			fromStatus: run.status ?? null,
			toStatus: "ready",
			data: null,
		});

		// 4. Enqueue artifact write
		await tx.insert(outbox).values({
			organizationId: input.organizationId,
			kind: "write_artifacts",
			payload: { runId: input.runId },
		});

		// 5. Enqueue execution
		await tx.insert(outbox).values({
			organizationId: input.organizationId,
			kind: "enqueue_execute",
			payload: { runId: input.runId },
		});

		return updated ?? null;
	});
}

export async function getEnrichmentResult(runId: string): Promise<Record<string, unknown> | null> {
	const run = await runsDb.findById(runId);
	if (!run) return null;
	return (run.enrichmentJson as Record<string, unknown>) ?? null;
}

// ============================================
// Run listing & assignment (user-facing)
// ============================================

export async function listRunsForAutomation(
	automationId: string,
	_orgId: string,
	options: { status?: string; limit?: number; offset?: number } = {},
): Promise<{ runs: runsDb.RunListItem[]; total: number }> {
	return runsDb.listRunsForAutomation(automationId, options);
}

export async function assignRunToUser(
	runId: string,
	orgId: string,
	userId: string,
): Promise<runsDb.AutomationRunRow | null> {
	const updated = await runsDb.assignRunToUser(runId, orgId, userId);
	if (updated) {
		return updated;
	}

	const existing = await runsDb.findById(runId);
	if (!existing || existing.organizationId !== orgId) {
		return null;
	}

	if (existing.assignedTo && existing.assignedTo !== userId) {
		throw new RunAlreadyAssignedError(existing.assignedTo);
	}

	return null;
}

export async function unassignRun(
	runId: string,
	orgId: string,
): Promise<runsDb.AutomationRunRow | null> {
	return runsDb.unassignRun(runId, orgId);
}

export async function listRunsAssignedToUser(
	userId: string,
	orgId: string,
): Promise<runsDb.RunListItem[]> {
	return runsDb.listRunsAssignedToUser(userId, orgId);
}

export type { PendingRunSummary } from "./db";

export async function listOrgPendingRuns(
	orgId: string,
	options?: { limit?: number; maxAgeDays?: number; unassignedOnly?: boolean },
): Promise<runsDb.PendingRunSummary[]> {
	return runsDb.listOrgPendingRuns(orgId, options);
}

export async function findRunForDisplay(
	runId: string,
	orgId: string,
): Promise<runsDb.RunListItem | null> {
	return runsDb.findRunForDisplay(runId, orgId);
}

export async function listRunEvents(
	runId: string,
	orgId: string,
): Promise<runsDb.AutomationRunEventRow[] | null> {
	return runsDb.listRunEvents(runId, orgId);
}

export type { AutomationRunEventRow } from "./db";

export async function listOrgRuns(
	orgId: string,
	options?: { status?: string; limit?: number; offset?: number },
): Promise<{ runs: runsDb.RunListItem[]; total: number }> {
	return runsDb.listOrgRuns(orgId, options);
}

// ============================================
// Manual run resolution
// ============================================

/** Statuses from which manual resolution is allowed. */
const RESOLVABLE_STATUSES = ["needs_human", "failed", "timed_out"];

/** Valid target statuses for manual resolution. */
const RESOLUTION_OUTCOMES = ["succeeded", "failed"] as const;
type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];

export class RunNotResolvableError extends Error {
	readonly status: string;
	constructor(status: string) {
		super(`Run in status '${status}' cannot be manually resolved`);
		this.status = status;
	}
}

export interface ResolveRunInput {
	runId: string;
	automationId: string;
	orgId: string;
	userId: string;
	outcome: string;
	reason?: string;
	comment?: string;
}

export async function resolveRun(input: ResolveRunInput): Promise<runsDb.AutomationRunRow | null> {
	if (!RESOLUTION_OUTCOMES.includes(input.outcome as ResolutionOutcome)) {
		throw new Error(`Invalid resolution outcome: ${input.outcome}`);
	}

	const db = getDb();
	return db.transaction(async (tx) => {
		// Read inside transaction for consistency
		const run = await tx.query.automationRuns.findFirst({
			where: eq(automationRuns.id, input.runId),
		});
		if (!run) return null;

		if (run.organizationId !== input.orgId) return null;
		if (run.automationId !== input.automationId) return null;

		if (!RESOLVABLE_STATUSES.includes(run.status)) {
			throw new RunNotResolvableError(run.status);
		}

		const fromStatus = run.status;
		const toStatus = input.outcome;
		validateTransition(fromStatus, toStatus);

		// Conditional update: only mutate if status hasn't changed (TOCTOU guard)
		const [updated] = await tx
			.update(automationRuns)
			.set({
				status: toStatus,
				statusReason: `manual_resolution:${input.reason ?? "resolved"}`,
				completedAt: run.completedAt ?? new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(automationRuns.id, input.runId),
					inArray(automationRuns.status, [...RESOLVABLE_STATUSES]),
				),
			)
			.returning();

		if (!updated) {
			// Status changed between read and write — concurrent mutation
			throw new RunNotResolvableError(run.status);
		}

		await tx.insert(automationRunEvents).values({
			runId: input.runId,
			type: "manual_resolution",
			fromStatus,
			toStatus,
			data: {
				userId: input.userId,
				reason: input.reason ?? null,
				comment: input.comment ?? null,
				previousStatus: fromStatus,
			},
		});

		try {
			await enqueueRunNotification(updated.organizationId, input.runId, toStatus);
		} catch {
			// Non-critical
		}

		return updated;
	});
}

export async function completeRun(
	input: CompleteRunInput,
): Promise<runsDb.AutomationRunRow | null> {
	const db = getDb();

	return db.transaction(async (tx) => {
		const run = await tx.query.automationRuns.findFirst({
			where: eq(automationRuns.id, input.runId),
		});
		if (!run) return null;

		if (input.sessionId && run.sessionId && run.sessionId !== input.sessionId) {
			throw new Error("Run session mismatch");
		}

		if (run.completionId) {
			if (run.completionId === input.completionId) {
				if (
					run.completionJson &&
					JSON.stringify(run.completionJson) !== JSON.stringify(input.completionJson)
				) {
					throw new Error("Completion payload mismatch for idempotent retry");
				}
				return run;
			}
			throw new Error("Completion already recorded");
		}

		const status =
			input.outcome === "needs_human"
				? "needs_human"
				: input.outcome === "failed"
					? "failed"
					: "succeeded";
		validateTransition(run.status, status);

		const [updated] = await tx
			.update(automationRuns)
			.set({
				status,
				completionId: input.completionId,
				completionJson: input.completionJson,
				completedAt: new Date(),
				statusReason: input.outcome,
				updatedAt: new Date(),
			})
			.where(and(eq(automationRuns.id, input.runId), eq(automationRuns.status, run.status)))
			.returning();
		if (!updated) {
			const latest = await tx.query.automationRuns.findFirst({
				where: eq(automationRuns.id, input.runId),
			});
			if (!latest) return null;

			if (latest.completionId === input.completionId) {
				if (
					latest.completionJson &&
					JSON.stringify(latest.completionJson) !== JSON.stringify(input.completionJson)
				) {
					throw new Error("Completion payload mismatch for idempotent retry");
				}
				return latest;
			}

			throw new Error("Run status changed during completion");
		}

		await tx.insert(automationRunEvents).values({
			runId: input.runId,
			type: "completion",
			fromStatus: run.status ?? null,
			toStatus: status,
			data: { outcome: input.outcome },
		});

		await tx.insert(outbox).values({
			organizationId: run.organizationId,
			kind: "write_artifacts",
			payload: { runId: run.id, kind: "completion" },
		});

		await tx.insert(outbox).values({
			organizationId: run.organizationId,
			kind: "notify_run_terminal",
			payload: { runId: run.id, status },
		});

		return updated ?? null;
	});
}
