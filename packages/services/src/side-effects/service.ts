/**
 * Side effects service - idempotent external actions.
 */

import { and, automationSideEffects, eq, getDb } from "../db/client";
import type { InferSelectModel } from "../db/client";

export type AutomationSideEffectRow = InferSelectModel<typeof automationSideEffects>;

export interface RecordSideEffectInput {
	organizationId: string;
	runId: string;
	effectId: string;
	kind: string;
	provider?: string | null;
	requestHash?: string | null;
	responseJson?: Record<string, unknown> | null;
}

export async function recordSideEffect(
	input: RecordSideEffectInput,
): Promise<AutomationSideEffectRow> {
	const db = getDb();
	const [row] = await db
		.insert(automationSideEffects)
		.values({
			organizationId: input.organizationId,
			runId: input.runId,
			effectId: input.effectId,
			kind: input.kind,
			provider: input.provider ?? null,
			requestHash: input.requestHash ?? null,
			responseJson: input.responseJson ?? null,
		})
		.returning();

	return row;
}

export async function findSideEffect(
	organizationId: string,
	effectId: string,
): Promise<AutomationSideEffectRow | null> {
	const db = getDb();
	const result = await db.query.automationSideEffects.findFirst({
		where: and(
			eq(automationSideEffects.organizationId, organizationId),
			eq(automationSideEffects.effectId, effectId),
		),
	});
	return result ?? null;
}

export async function recordOrReplaySideEffect(
	input: RecordSideEffectInput,
): Promise<{ row: AutomationSideEffectRow; replayed: boolean }> {
	const existing = await findSideEffect(input.organizationId, input.effectId);
	if (existing) {
		return { row: existing, replayed: true };
	}

	try {
		const row = await recordSideEffect(input);
		return { row, replayed: false };
	} catch (error) {
		const row = await findSideEffect(input.organizationId, input.effectId);
		if (row) {
			return { row, replayed: true };
		}
		throw error;
	}
}
