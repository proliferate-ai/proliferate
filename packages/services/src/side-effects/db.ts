/**
 * Side effects DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import { and, automationSideEffects, eq, getDb } from "../db/client";
import type { InferSelectModel } from "../db/client";

export type AutomationSideEffectRow = InferSelectModel<typeof automationSideEffects>;

export async function insertSideEffect(input: {
	organizationId: string;
	runId: string;
	effectId: string;
	kind: string;
	provider: string | null;
	requestHash: string | null;
	responseJson: Record<string, unknown> | null;
}): Promise<AutomationSideEffectRow> {
	const db = getDb();
	const [row] = await db
		.insert(automationSideEffects)
		.values({
			organizationId: input.organizationId,
			runId: input.runId,
			effectId: input.effectId,
			kind: input.kind,
			provider: input.provider,
			requestHash: input.requestHash,
			responseJson: input.responseJson,
		})
		.returning();

	return row;
}

export async function findByOrgAndEffectId(
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
