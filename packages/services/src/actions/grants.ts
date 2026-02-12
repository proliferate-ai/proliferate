/**
 * Action grants service.
 *
 * Business logic for scoped action grants that auto-approve write actions.
 */

import { getServicesLogger } from "../logger";
import type { ActionGrantRow, CreateGrantInput } from "./grants-db";
import * as grantsDb from "./grants-db";

// ============================================
// Error Classes
// ============================================

export class GrantNotFoundError extends Error {
	constructor(message = "Grant not found") {
		super(message);
		this.name = "GrantNotFoundError";
	}
}

export class GrantExhaustedError extends Error {
	constructor(message = "Grant call budget exhausted") {
		super(message);
		this.name = "GrantExhaustedError";
	}
}

// ============================================
// Types
// ============================================

export interface EvaluateGrantResult {
	granted: boolean;
	grantId?: string;
}

// ============================================
// Service Functions
// ============================================

/**
 * Create a new action grant.
 */
export async function createGrant(input: CreateGrantInput): Promise<ActionGrantRow> {
	const log = getServicesLogger().child({ module: "actions.grants" });
	const grant = await grantsDb.createGrant(input);
	log.info(
		{
			grantId: grant.id,
			integration: input.integration,
			action: input.action,
			maxCalls: input.maxCalls,
		},
		"Grant created",
	);
	return grant;
}

/**
 * List active grants for an org, optionally filtered by session.
 */
export async function listActiveGrants(
	organizationId: string,
	sessionId?: string,
	options?: { limit?: number; offset?: number },
): Promise<ActionGrantRow[]> {
	return grantsDb.listActiveGrants(organizationId, sessionId, options);
}

/**
 * List all grants for an org (including revoked/expired).
 */
export async function listGrantsByOrg(
	organizationId: string,
	options?: { limit?: number; offset?: number },
): Promise<ActionGrantRow[]> {
	return grantsDb.listGrantsByOrg(organizationId, options);
}

/**
 * Delete expired grants (cleanup job).
 * Safe/idempotent — only removes grants whose expiresAt has passed.
 */
export async function cleanupExpiredGrants(): Promise<number> {
	const log = getServicesLogger().child({ module: "actions.grants" });
	const deleted = await grantsDb.deleteExpiredGrants(new Date());
	if (deleted > 0) {
		log.info({ deleted }, "Expired grants cleaned up");
	}
	return deleted;
}

/**
 * Evaluate whether a matching grant exists for the given action invocation.
 * If a match is found, atomically consumes one call from the grant's budget.
 *
 * Returns { granted: true, grantId } if auto-approved via grant,
 * or { granted: false } if no matching grant exists.
 */
export async function evaluateGrant(
	organizationId: string,
	integration: string,
	action: string,
	sessionId?: string,
): Promise<EvaluateGrantResult> {
	const log = getServicesLogger().child({ module: "actions.grants" });

	const candidates = await grantsDb.findMatchingGrants(
		organizationId,
		integration,
		action,
		sessionId,
	);

	if (candidates.length === 0) {
		return { granted: false };
	}

	// Try each candidate — CAS ensures only one consumer wins per call
	for (const candidate of candidates) {
		const consumed = await grantsDb.consumeGrantCall(candidate.id);
		if (consumed) {
			log.info(
				{
					grantId: consumed.id,
					integration,
					action,
					usedCalls: consumed.usedCalls,
					maxCalls: consumed.maxCalls,
				},
				"Grant matched and consumed",
			);
			if (consumed.maxCalls != null && consumed.usedCalls >= consumed.maxCalls) {
				log.info(
					{ grantId: consumed.id, usedCalls: consumed.usedCalls, maxCalls: consumed.maxCalls },
					"Grant exhausted",
				);
			}
			return { granted: true, grantId: consumed.id };
		}
	}

	// All candidates were exhausted/expired/revoked between query and CAS
	return { granted: false };
}

/**
 * Revoke an existing grant.
 */
export async function revokeGrant(
	grantId: string,
	organizationId: string,
): Promise<ActionGrantRow> {
	const log = getServicesLogger().child({ module: "actions.grants" });
	const revoked = await grantsDb.revokeGrant(grantId, organizationId);
	if (!revoked) {
		throw new GrantNotFoundError();
	}
	log.info({ grantId }, "Grant revoked");
	return revoked;
}

/**
 * Get a single grant by ID.
 */
export async function getGrant(
	grantId: string,
	organizationId: string,
): Promise<ActionGrantRow | undefined> {
	return grantsDb.getGrant(grantId, organizationId);
}
