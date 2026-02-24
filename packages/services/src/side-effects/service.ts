/**
 * Side effects service - idempotent external actions.
 */

import { type AutomationSideEffectRow, findByOrgAndEffectId, insertSideEffect } from "./db";

export type { AutomationSideEffectRow } from "./db";

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
	return insertSideEffect({
		organizationId: input.organizationId,
		runId: input.runId,
		effectId: input.effectId,
		kind: input.kind,
		provider: input.provider ?? null,
		requestHash: input.requestHash ?? null,
		responseJson: input.responseJson ?? null,
	});
}

export async function findSideEffect(
	organizationId: string,
	effectId: string,
): Promise<AutomationSideEffectRow | null> {
	return findByOrgAndEffectId(organizationId, effectId);
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
