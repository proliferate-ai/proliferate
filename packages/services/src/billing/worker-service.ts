import {
	cleanOldBillingEventKeys,
	ensureBillingPartition,
	getLLMSpendCursor,
	listBillableOrgIds,
	listBillableOrgsWithCustomerId,
	listBillingEventPartitions,
	listStaleReconcileOrgs,
	updateLLMSpendCursor,
} from "./db";
import type { LLMSpendCursor } from "./db";

/**
 * Worker-safe wrappers over billing DB operations.
 * Keep `db.ts` internal to the billing module boundary.
 */
export async function listBillableOrgIdsForBillingWorker(): Promise<string[]> {
	return listBillableOrgIds();
}

export async function getLLMSpendCursorForBillingWorker(
	organizationId: string,
): Promise<LLMSpendCursor | null> {
	return getLLMSpendCursor(organizationId);
}

export async function updateLLMSpendCursorForBillingWorker(cursor: LLMSpendCursor): Promise<void> {
	await updateLLMSpendCursor(cursor);
}

export async function ensureBillingPartitionForMaintenance(
	partitionName: string,
	rangeStart: string,
	rangeEnd: string,
): Promise<boolean> {
	return ensureBillingPartition(partitionName, rangeStart, rangeEnd);
}

export async function cleanOldBillingEventKeysForMaintenance(cutoff: Date): Promise<number> {
	return cleanOldBillingEventKeys(cutoff);
}

export async function listBillingEventPartitionsForMaintenance(): Promise<string[]> {
	return listBillingEventPartitions();
}

export async function listBillableOrgsWithCustomerIdForReconcile(): Promise<
	{ id: string; autumnCustomerId: string }[]
> {
	return listBillableOrgsWithCustomerId();
}

export async function listStaleReconcileOrgsForReconcile(
	maxAgeMs: number,
): Promise<{ id: string; lastReconciledAt: Date | null }[]> {
	return listStaleReconcileOrgs(maxAgeMs);
}
