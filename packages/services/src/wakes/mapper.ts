/**
 * Wake event mapping and domain helpers.
 *
 * Pure functions for wake payload parsing and coalescing logic.
 */

import { isRecord } from "@proliferate/shared/type-guards";
import type { WakeEventRow } from "./db";

export function extractWakeDedupeKey(payload: unknown): string | null {
	if (!isRecord(payload)) {
		return null;
	}

	const directKey = payload.dedupeKey;
	if (typeof directKey === "string" && directKey.trim().length > 0) {
		return directKey.trim();
	}

	const providerEventId = payload.providerEventId;
	if (typeof providerEventId === "string" && providerEventId.trim().length > 0) {
		return providerEventId.trim();
	}

	const externalEventId = payload.externalEventId;
	if (typeof externalEventId === "string" && externalEventId.trim().length > 0) {
		return externalEventId.trim();
	}

	return null;
}

export function buildMergedWakePayload(
	basePayload: unknown,
	coalescedRows: WakeEventRow[],
): Record<string, unknown> {
	const base = isRecord(basePayload) ? { ...basePayload } : {};

	const existingIdsRaw = base.coalescedWakeEventIds;
	const existingIds =
		Array.isArray(existingIdsRaw) && existingIdsRaw.every((id) => typeof id === "string")
			? existingIdsRaw
			: [];

	const mergedIds = Array.from(new Set([...existingIds, ...coalescedRows.map((row) => row.id)]));

	const existingRefsRaw = base.coalescedWakeRefs;
	const existingRefs = Array.isArray(existingRefsRaw) ? existingRefsRaw : [];

	const newRefs = coalescedRows.map((row) => ({
		wakeEventId: row.id,
		source: row.source,
		dedupeKey: extractWakeDedupeKey(row.payloadJson),
	}));

	return {
		...base,
		coalescedWakeEventIds: mergedIds,
		coalescedWakeRefs: [...existingRefs, ...newRefs],
	};
}
