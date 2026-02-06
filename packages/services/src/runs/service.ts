/**
 * Automation runs service.
 */

import { automationRunEvents, automationRuns, eq, outbox, triggerEvents } from "../db/client";
import { getDb } from "../db/client";
import type { TriggerEventRow } from "../triggers/db";
import * as runsDb from "./db";

export interface CreateRunFromTriggerEventInput {
	triggerId: string;
	organizationId: string;
	automationId: string;
	externalEventId: string | null;
	providerEventType: string | null;
	rawPayload: Record<string, unknown>;
	parsedContext: Record<string, unknown> | null;
	dedupKey: string | null;
}

export interface CreateRunFromTriggerEventResult {
	run: runsDb.AutomationRunRow;
	event: TriggerEventRow;
}

export async function createRunFromTriggerEvent(
	input: CreateRunFromTriggerEventInput,
): Promise<CreateRunFromTriggerEventResult> {
	const db = getDb();

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

		const [run] = await tx
			.insert(automationRuns)
			.values({
				organizationId: input.organizationId,
				automationId: input.automationId,
				triggerEventId: event.id,
				triggerId: input.triggerId,
				status: "queued",
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

export async function transitionRunStatus(
	runId: string,
	toStatus: string,
	updates?: Partial<runsDb.AutomationRunRow>,
	data?: Record<string, unknown> | null,
): Promise<runsDb.AutomationRunRow | null> {
	const run = await runsDb.findById(runId);
	if (!run) return null;
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
	return transitionRunStatus(
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
	return runsDb.assignRunToUser(runId, orgId, userId);
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
			.where(eq(automationRuns.id, input.runId))
			.returning();

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

		return updated ?? null;
	});
}
