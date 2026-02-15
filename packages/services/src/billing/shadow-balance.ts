/**
 * Shadow Balance Management (Billing V2)
 *
 * Shadow balance is a locally-cached credit balance that is:
 * - Updated atomically with billing event insertions
 * - Periodically reconciled with Autumn
 * - Never deducted outside a transaction
 *
 * Key invariant: shadow_balance update MUST be atomic with billing_events insert.
 */

import type { BillingState, ReconciliationType } from "@proliferate/shared/billing";
import {
	GRACE_WINDOW_CONFIG,
	getStateUpdateFields,
	processStateTransition,
} from "@proliferate/shared/billing";
import { billingEvents, billingReconciliations, eq, getDb, organization } from "../db/client";

// ============================================
// Types
// ============================================

export interface ShadowBalanceUpdate {
	organizationId: string;
	/** Raw usage quantity (seconds for compute, credits for LLM) */
	quantity: number;
	credits: number;
	eventType: "compute" | "llm";
	idempotencyKey: string;
	sessionIds?: string[];
	metadata?: Record<string, unknown>;
}

export interface DeductResult {
	success: boolean;
	previousState: BillingState;
	previousBalance: number;
	newBalance: number;
	stateChanged: boolean;
	newState?: BillingState;
	/** If true, sessions should be terminated */
	shouldTerminateSessions: boolean;
	/** If true, new sessions should be blocked */
	shouldBlockNewSessions: boolean;
	/** Reason for any enforcement action */
	enforcementReason?: string;
}

export interface BulkDeductEvent {
	credits: number;
	quantity: number;
	eventType: "compute" | "llm";
	idempotencyKey: string;
	sessionIds?: string[];
	metadata?: Record<string, unknown>;
}

export interface BulkDeductResult {
	insertedCount: number;
	totalCreditsDeducted: number;
	previousBalance: number;
	newBalance: number;
	stateChanged: boolean;
	newState?: BillingState;
	shouldTerminateSessions: boolean;
	shouldBlockNewSessions: boolean;
	enforcementReason?: string;
}

export interface ReconcileResult {
	success: boolean;
	previousBalance: number;
	newBalance: number;
	delta: number;
	reconciliationId?: string;
}

// ============================================
// Shadow Balance Operations
// ============================================

/**
 * Deduct credits from shadow balance atomically with billing event insertion.
 * This is the ONLY way to deduct from shadow balance.
 *
 * Returns:
 * - success: false if idempotency key already exists (already processed)
 * - stateChanged: true if billing state transitioned due to balance change
 */
export async function deductShadowBalance(update: ShadowBalanceUpdate): Promise<DeductResult> {
	const db = getDb();

	// Use a transaction to ensure atomic update
	return await db.transaction(async (tx) => {
		// Get current org state with FOR UPDATE lock
		const [org] = await tx
			.select({
				billingState: organization.billingState,
				shadowBalance: organization.shadowBalance,
				graceExpiresAt: organization.graceExpiresAt,
			})
			.from(organization)
			.where(eq(organization.id, update.organizationId))
			.for("update");

		if (!org) {
			throw new Error(`Organization not found: ${update.organizationId}`);
		}

		const previousBalance = Number(org.shadowBalance ?? 0);
		const newBalance = previousBalance - update.credits;
		const currentState = org.billingState as BillingState;
		const outboxStatus =
			currentState === "trial" || currentState === "unconfigured" ? "skipped" : "pending";

		// Insert the billing event, skipping if idempotency key already exists.
		// Uses onConflictDoNothing to avoid aborting the transaction on duplicates
		// (a caught constraint violation still aborts the PG transaction state).
		const inserted = await tx
			.insert(billingEvents)
			.values({
				organizationId: update.organizationId,
				eventType: update.eventType,
				quantity: update.quantity.toString(),
				credits: update.credits.toString(),
				idempotencyKey: update.idempotencyKey,
				sessionIds: update.sessionIds ?? [],
				status: outboxStatus,
				metadata: update.metadata ?? {},
			})
			.onConflictDoNothing({ target: billingEvents.idempotencyKey })
			.returning({ id: billingEvents.id });

		if (inserted.length === 0) {
			// Already processed - idempotency key exists
			return {
				success: false,
				previousState: currentState,
				previousBalance,
				newBalance: previousBalance,
				stateChanged: false,
				shouldTerminateSessions: false,
				shouldBlockNewSessions: false,
			};
		}

		// Check if we need to transition state due to balance depletion
		let stateChanged = false;
		let newState = currentState;
		let shouldTerminateSessions = false;
		let shouldBlockNewSessions = false;
		let enforcementReason: string | undefined;
		let graceExpiresAt = org.graceExpiresAt;

		if (newBalance <= 0 && (currentState === "active" || currentState === "trial")) {
			// Balance depleted - transition to grace
			const transition = processStateTransition(currentState, { type: "balance_depleted" });

			if (transition.transitioned) {
				stateChanged = true;
				newState = transition.newState;
				graceExpiresAt = transition.graceExpiresAt ?? null;

				if (transition.action.type === "terminate_sessions") {
					shouldTerminateSessions = true;
					enforcementReason = transition.action.reason;
				} else if (transition.action.type === "block_new_sessions") {
					shouldBlockNewSessions = true;
					enforcementReason = transition.action.reason;
				}
			}
		}

		// Soft overdraft cap: we transition after deduction to keep the ledger accurate,
		// which can overshoot by a single large deduction.
		const overdraftLimit = GRACE_WINDOW_CONFIG.maxOverdraftCredits;
		const overdraftExceeded = overdraftLimit > 0 && newBalance <= -overdraftLimit;

		if (overdraftExceeded && (currentState === "grace" || newState === "grace")) {
			const transition = processStateTransition("grace", { type: "grace_expired" });

			if (transition.transitioned) {
				stateChanged = true;
				newState = transition.newState;
				graceExpiresAt = null;
				shouldBlockNewSessions = false;
				if (transition.action.type === "terminate_sessions") {
					shouldTerminateSessions = true;
					enforcementReason = transition.action.reason;
				}
			}
		}

		// Update shadow balance and state atomically
		const updateFields: Record<string, unknown> = {
			shadowBalance: newBalance.toString(),
			shadowBalanceUpdatedAt: new Date(),
		};

		if (stateChanged) {
			const stateFields = getStateUpdateFields({
				previousState: currentState,
				newState,
				transitioned: true,
				action: { type: "none" },
				graceExpiresAt: graceExpiresAt ?? undefined,
			});
			updateFields.billingState = stateFields.billingState;
			if (stateFields.graceEnteredAt !== undefined) {
				updateFields.graceEnteredAt = stateFields.graceEnteredAt;
			}
			if (stateFields.graceExpiresAt !== undefined) {
				updateFields.graceExpiresAt = stateFields.graceExpiresAt;
			}
		}

		await tx
			.update(organization)
			.set(updateFields)
			.where(eq(organization.id, update.organizationId));

		return {
			success: true,
			previousState: currentState,
			previousBalance,
			newBalance,
			stateChanged,
			newState: stateChanged ? newState : undefined,
			shouldTerminateSessions,
			shouldBlockNewSessions,
			enforcementReason,
		};
	});
}

/**
 * Bulk-deduct credits from shadow balance for multiple events in a single transaction.
 *
 * Opens exactly ONE Postgres transaction:
 * 1. Locks the org row (FOR UPDATE)
 * 2. Bulk INSERTs billing events with ON CONFLICT (idempotency_key) DO NOTHING
 * 3. Sums credits only for the newly inserted rows
 * 4. Deducts that sum from the shadow balance
 *
 * This eliminates per-event row-lock contention for high-throughput LLM spend sync.
 */
export async function bulkDeductShadowBalance(
	organizationId: string,
	events: BulkDeductEvent[],
): Promise<BulkDeductResult> {
	const db = getDb();

	if (events.length === 0) {
		const balance = await getShadowBalance(organizationId);
		const current = balance?.balance ?? 0;
		return {
			insertedCount: 0,
			totalCreditsDeducted: 0,
			previousBalance: current,
			newBalance: current,
			stateChanged: false,
			shouldTerminateSessions: false,
			shouldBlockNewSessions: false,
		};
	}

	return await db.transaction(async (tx) => {
		// 1. Lock the org row
		const [org] = await tx
			.select({
				billingState: organization.billingState,
				shadowBalance: organization.shadowBalance,
				graceExpiresAt: organization.graceExpiresAt,
			})
			.from(organization)
			.where(eq(organization.id, organizationId))
			.for("update");

		if (!org) {
			throw new Error(`Organization not found: ${organizationId}`);
		}

		const previousBalance = Number(org.shadowBalance ?? 0);
		const currentState = org.billingState as BillingState;
		const outboxStatus =
			currentState === "trial" || currentState === "unconfigured" ? "skipped" : "pending";

		// 2. Bulk insert billing events, skipping duplicates via idempotency key
		const inserted = await tx
			.insert(billingEvents)
			.values(
				events.map((e) => ({
					organizationId,
					eventType: e.eventType,
					quantity: e.quantity.toString(),
					credits: e.credits.toString(),
					idempotencyKey: e.idempotencyKey,
					sessionIds: e.sessionIds ?? [],
					status: outboxStatus,
					metadata: e.metadata ?? {},
				})),
			)
			.onConflictDoNothing({ target: billingEvents.idempotencyKey })
			.returning({ id: billingEvents.id, credits: billingEvents.credits });

		if (inserted.length === 0) {
			return {
				insertedCount: 0,
				totalCreditsDeducted: 0,
				previousBalance,
				newBalance: previousBalance,
				stateChanged: false,
				shouldTerminateSessions: false,
				shouldBlockNewSessions: false,
			};
		}

		// 3. Sum credits only for successfully inserted rows
		const totalCreditsDeducted = inserted.reduce(
			(sum, row) => sum + Number(row.credits),
			0,
		);
		const newBalance = previousBalance - totalCreditsDeducted;

		// 4. Evaluate state transitions
		let stateChanged = false;
		let newState = currentState;
		let shouldTerminateSessions = false;
		let shouldBlockNewSessions = false;
		let enforcementReason: string | undefined;
		let graceExpiresAt = org.graceExpiresAt;

		if (newBalance <= 0 && (currentState === "active" || currentState === "trial")) {
			const transition = processStateTransition(currentState, { type: "balance_depleted" });
			if (transition.transitioned) {
				stateChanged = true;
				newState = transition.newState;
				graceExpiresAt = transition.graceExpiresAt ?? null;
				if (transition.action.type === "terminate_sessions") {
					shouldTerminateSessions = true;
					enforcementReason = transition.action.reason;
				} else if (transition.action.type === "block_new_sessions") {
					shouldBlockNewSessions = true;
					enforcementReason = transition.action.reason;
				}
			}
		}

		const overdraftLimit = GRACE_WINDOW_CONFIG.maxOverdraftCredits;
		const overdraftExceeded = overdraftLimit > 0 && newBalance <= -overdraftLimit;

		if (overdraftExceeded && (currentState === "grace" || newState === "grace")) {
			const transition = processStateTransition("grace", { type: "grace_expired" });
			if (transition.transitioned) {
				stateChanged = true;
				newState = transition.newState;
				graceExpiresAt = null;
				shouldBlockNewSessions = false;
				if (transition.action.type === "terminate_sessions") {
					shouldTerminateSessions = true;
					enforcementReason = transition.action.reason;
				}
			}
		}

		// 5. Update shadow balance and state atomically
		const updateFields: Record<string, unknown> = {
			shadowBalance: newBalance.toString(),
			shadowBalanceUpdatedAt: new Date(),
		};

		if (stateChanged) {
			const stateFields = getStateUpdateFields({
				previousState: currentState,
				newState,
				transitioned: true,
				action: { type: "none" },
				graceExpiresAt: graceExpiresAt ?? undefined,
			});
			updateFields.billingState = stateFields.billingState;
			if (stateFields.graceEnteredAt !== undefined) {
				updateFields.graceEnteredAt = stateFields.graceEnteredAt;
			}
			if (stateFields.graceExpiresAt !== undefined) {
				updateFields.graceExpiresAt = stateFields.graceExpiresAt;
			}
		}

		await tx
			.update(organization)
			.set(updateFields)
			.where(eq(organization.id, organizationId));

		return {
			insertedCount: inserted.length,
			totalCreditsDeducted,
			previousBalance,
			newBalance,
			stateChanged,
			newState: stateChanged ? newState : undefined,
			shouldTerminateSessions,
			shouldBlockNewSessions,
			enforcementReason,
		};
	});
}

/**
 * Add credits to shadow balance (for top-ups, refunds, etc.).
 * Also handles state transitions back to active if needed.
 */
export async function addShadowBalance(
	organizationId: string,
	credits: number,
	reason: string,
	performedBy?: string,
): Promise<DeductResult> {
	const db = getDb();

	return await db.transaction(async (tx) => {
		// Get current org state with FOR UPDATE lock
		const [org] = await tx
			.select({
				billingState: organization.billingState,
				shadowBalance: organization.shadowBalance,
			})
			.from(organization)
			.where(eq(organization.id, organizationId))
			.for("update");

		if (!org) {
			throw new Error(`Organization not found: ${organizationId}`);
		}

		const previousBalance = Number(org.shadowBalance ?? 0);
		const newBalance = previousBalance + credits;
		const currentState = org.billingState as BillingState;

		// Check if we need to transition state due to credits being added
		let stateChanged = false;
		let newState = currentState;

		if (newBalance > 0 && (currentState === "grace" || currentState === "exhausted")) {
			// Credits added - transition back to active
			const transition = processStateTransition(currentState, {
				type: "credits_added",
				amount: credits,
			});

			if (transition.transitioned) {
				stateChanged = true;
				newState = transition.newState;
			}
		}

		// Update shadow balance and state
		const updateFields: Record<string, unknown> = {
			shadowBalance: newBalance.toString(),
			shadowBalanceUpdatedAt: new Date(),
		};

		if (stateChanged) {
			const stateFields = getStateUpdateFields({
				previousState: currentState,
				newState,
				transitioned: true,
				action: { type: "none" },
			});
			updateFields.billingState = stateFields.billingState;
			if (stateFields.graceEnteredAt !== undefined) {
				updateFields.graceEnteredAt = stateFields.graceEnteredAt;
			}
			if (stateFields.graceExpiresAt !== undefined) {
				updateFields.graceExpiresAt = stateFields.graceExpiresAt;
			}
		}

		await tx.update(organization).set(updateFields).where(eq(organization.id, organizationId));

		// Insert reconciliation record
		await tx.insert(billingReconciliations).values({
			organizationId,
			type: "manual_adjustment",
			previousBalance: previousBalance.toString(),
			newBalance: newBalance.toString(),
			delta: credits.toString(),
			reason,
			performedBy: performedBy ?? null,
			metadata: {},
		});

		return {
			success: true,
			previousState: currentState,
			previousBalance,
			newBalance,
			stateChanged,
			newState: stateChanged ? newState : undefined,
			shouldTerminateSessions: false,
			shouldBlockNewSessions: false,
		};
	});
}

/**
 * Reconcile shadow balance with Autumn's actual balance.
 * Used to correct drift between local and remote state.
 */
export async function reconcileShadowBalance(
	organizationId: string,
	actualBalance: number,
	type: ReconciliationType,
	reason: string,
	performedBy?: string,
): Promise<ReconcileResult> {
	const db = getDb();

	return await db.transaction(async (tx) => {
		// Get current shadow balance
		const [org] = await tx
			.select({
				shadowBalance: organization.shadowBalance,
			})
			.from(organization)
			.where(eq(organization.id, organizationId))
			.for("update");

		if (!org) {
			throw new Error(`Organization not found: ${organizationId}`);
		}

		const previousBalance = Number(org.shadowBalance ?? 0);
		const delta = actualBalance - previousBalance;

		// Update shadow balance
		await tx
			.update(organization)
			.set({
				shadowBalance: actualBalance.toString(),
				shadowBalanceUpdatedAt: new Date(),
			})
			.where(eq(organization.id, organizationId));

		// Insert reconciliation record
		const [reconciliation] = await tx
			.insert(billingReconciliations)
			.values({
				organizationId,
				type,
				previousBalance: previousBalance.toString(),
				newBalance: actualBalance.toString(),
				delta: delta.toString(),
				reason,
				performedBy: performedBy ?? null,
				metadata: {
					actual_balance: actualBalance,
					reconciled_at: new Date().toISOString(),
				},
			})
			.returning({ id: billingReconciliations.id });

		return {
			success: true,
			previousBalance,
			newBalance: actualBalance,
			delta,
			reconciliationId: reconciliation?.id,
		};
	});
}

/**
 * Get the current shadow balance for an organization.
 */
export async function getShadowBalance(
	organizationId: string,
): Promise<{ balance: number; updatedAt: Date | null } | null> {
	const db = getDb();

	const [org] = await db
		.select({
			shadowBalance: organization.shadowBalance,
			shadowBalanceUpdatedAt: organization.shadowBalanceUpdatedAt,
		})
		.from(organization)
		.where(eq(organization.id, organizationId));

	if (!org) {
		return null;
	}

	return {
		balance: Number(org.shadowBalance ?? 0),
		updatedAt: org.shadowBalanceUpdatedAt,
	};
}

/**
 * Initialize shadow balance from Autumn for a new organization.
 * Called when billing is first set up.
 */
export async function initializeShadowBalance(
	organizationId: string,
	initialBalance: number,
	billingState: BillingState,
): Promise<void> {
	const db = getDb();

	await db
		.update(organization)
		.set({
			shadowBalance: initialBalance.toString(),
			shadowBalanceUpdatedAt: new Date(),
			billingState,
		})
		.where(eq(organization.id, organizationId));
}
