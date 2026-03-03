/**
 * Baselines service.
 *
 * Business logic for baseline resolution, status machine, and setup session invariant.
 */

import { type RepoBaselineStatus, isValidRepoBaselineTransition } from "@proliferate/shared";
import { getServicesLogger } from "../logger";
import * as baselinesDb from "./db";
import type { RepoBaselineRow, RepoBaselineTargetRow } from "./db";

const logger = () => getServicesLogger().child({ module: "baselines" });

// ============================================
// Types
// ============================================

export interface BaselineResolutionResult {
	baseline: RepoBaselineRow;
	target: RepoBaselineTargetRow;
}

export interface ResolveTargetInput {
	baselineId: string;
	/** Explicit target ID from session creation input */
	repoBaselineTargetId?: string | null;
	/** Explicit target name from session creation input */
	targetName?: string | null;
}

// ============================================
// J1: Baseline Resolution Flow
// ============================================

/**
 * Resolve the active baseline for a repo.
 * Task sessions require exactly one active (ready) baseline per repo.
 */
export async function resolveActiveBaseline(
	repoId: string,
	orgId: string,
): Promise<RepoBaselineRow> {
	const baseline = await baselinesDb.findActiveBaseline(repoId, orgId);

	if (!baseline) {
		throw new Error(
			`No active baseline found for repo ${repoId}. Run setup to create a validated baseline before starting task sessions.`,
		);
	}

	return baseline;
}

/**
 * Resolve target using deterministic priority order:
 * 1. Explicit repoBaselineTargetId
 * 2. Explicit target name
 * 3. Baseline default target (first target, by convention)
 * 4. Sole target (when exactly one exists)
 * 5. Fail with deterministic error
 */
export async function resolveTarget(input: ResolveTargetInput): Promise<RepoBaselineTargetRow> {
	// 1. Explicit target ID
	if (input.repoBaselineTargetId) {
		const target = await baselinesDb.findTargetById(input.repoBaselineTargetId);
		if (!target) {
			throw new Error(`Baseline target ${input.repoBaselineTargetId} not found`);
		}
		if (target.repoBaselineId !== input.baselineId) {
			throw new Error(
				`Target ${input.repoBaselineTargetId} does not belong to baseline ${input.baselineId}`,
			);
		}
		return target;
	}

	// 2. Explicit target name
	if (input.targetName) {
		const target = await baselinesDb.findTargetByName(input.baselineId, input.targetName);
		if (!target) {
			throw new Error(
				`No target named "${input.targetName}" found in baseline ${input.baselineId}`,
			);
		}
		return target;
	}

	// 3 & 4. Default target or sole target
	const targets = await baselinesDb.listTargetsByBaseline(input.baselineId);

	if (targets.length === 0) {
		throw new Error(
			`Baseline ${input.baselineId} has no targets. At least one target must be created during setup.`,
		);
	}

	if (targets.length === 1) {
		// 4. Sole target
		return targets[0];
	}

	// 3. Baseline default target — first target by convention
	// In V1, the first target created is the default.
	return targets[0];
}

/**
 * Full baseline resolution flow for task session boot.
 *
 * Steps:
 * 1. Resolve active baseline (exactly one per repo)
 * 2. Resolve target (deterministic order)
 *
 * Env bundle attachment, git freshness, capability materialization, and
 * runtime start are handled by the session/gateway layer.
 */
export async function resolveBaselineForTaskSession(input: {
	repoId: string;
	orgId: string;
	repoBaselineTargetId?: string | null;
	targetName?: string | null;
}): Promise<BaselineResolutionResult> {
	const baseline = await resolveActiveBaseline(input.repoId, input.orgId);

	const target = await resolveTarget({
		baselineId: baseline.id,
		repoBaselineTargetId: input.repoBaselineTargetId,
		targetName: input.targetName,
	});

	logger().info(
		{ repoId: input.repoId, baselineId: baseline.id, targetId: target.id },
		"Resolved baseline for task session",
	);

	return { baseline, target };
}

// ============================================
// J2: Baseline Status Machine
// ============================================

/**
 * Transition a baseline's status with validation.
 * Uses the shared isValidRepoBaselineTransition() function.
 */
export async function transitionStatus(input: {
	baselineId: string;
	orgId: string;
	fromStatus: RepoBaselineStatus;
	toStatus: RepoBaselineStatus;
	fields?: {
		version?: string;
		snapshotId?: string;
		sandboxProvider?: string;
		setupSessionId?: string;
		installCommands?: unknown;
		runCommands?: unknown;
		testCommands?: unknown;
		serviceCommands?: unknown;
		errorMessage?: string | null;
	};
}): Promise<RepoBaselineRow> {
	if (!isValidRepoBaselineTransition(input.fromStatus, input.toStatus)) {
		throw new Error(`Invalid baseline transition: ${input.fromStatus} → ${input.toStatus}`);
	}

	const result = await baselinesDb.transitionBaselineStatus({
		id: input.baselineId,
		orgId: input.orgId,
		fromStatus: input.fromStatus,
		toStatus: input.toStatus,
		fields: input.fields,
	});

	if (!result) {
		throw new Error(
			`Baseline ${input.baselineId} transition failed — ` +
				`expected status ${input.fromStatus} but current status differs (CAS conflict)`,
		);
	}

	logger().info(
		{ baselineId: input.baselineId, from: input.fromStatus, to: input.toStatus },
		"Baseline status transitioned",
	);

	return result;
}

/**
 * Mark a baseline as ready (validating → ready).
 * Supersede policy: the previous ready baseline (if any) is marked stale.
 */
export async function markBaselineReady(input: {
	baselineId: string;
	orgId: string;
	repoId: string;
	fields?: {
		version?: string;
		snapshotId?: string;
		sandboxProvider?: string;
		installCommands?: unknown;
		runCommands?: unknown;
		testCommands?: unknown;
		serviceCommands?: unknown;
	};
}): Promise<RepoBaselineRow> {
	const result = await transitionStatus({
		baselineId: input.baselineId,
		orgId: input.orgId,
		fromStatus: "validating",
		toStatus: "ready",
		fields: {
			...input.fields,
			errorMessage: null,
		},
	});

	// Supersede policy: mark any other ready baseline for this repo as stale
	await baselinesDb.markReadyBaselineStale(input.repoId, input.orgId, input.baselineId);

	return result;
}

/**
 * Mark a baseline as failed (validating → failed).
 */
export async function markBaselineFailed(input: {
	baselineId: string;
	orgId: string;
	errorMessage: string;
}): Promise<RepoBaselineRow> {
	return transitionStatus({
		baselineId: input.baselineId,
		orgId: input.orgId,
		fromStatus: "validating",
		toStatus: "failed",
		fields: { errorMessage: input.errorMessage },
	});
}

/**
 * Mark a baseline as stale (ready → stale).
 * Stale detection sources: dependency changes, explicit refresh, repeated failures.
 */
export async function markBaselineStale(input: {
	baselineId: string;
	orgId: string;
}): Promise<RepoBaselineRow> {
	return transitionStatus({
		baselineId: input.baselineId,
		orgId: input.orgId,
		fromStatus: "ready",
		toStatus: "stale",
	});
}

/**
 * Restart validation on a baseline (stale|failed|ready → validating).
 */
export async function restartValidation(input: {
	baselineId: string;
	orgId: string;
	fromStatus: RepoBaselineStatus;
	setupSessionId?: string;
}): Promise<RepoBaselineRow> {
	return transitionStatus({
		baselineId: input.baselineId,
		orgId: input.orgId,
		fromStatus: input.fromStatus,
		toStatus: "validating",
		fields: {
			setupSessionId: input.setupSessionId,
			errorMessage: null,
		},
	});
}

// ============================================
// J3: Setup Session Invariant
// ============================================

/**
 * Check if a non-terminal setup session exists for a repo.
 * Returns the existing session ID if one exists.
 */
export async function checkSetupSessionInvariant(
	repoId: string,
	orgId: string,
): Promise<{ existingSessionId: string } | null> {
	const existing = await baselinesDb.findNonTerminalSetupSession(repoId, orgId);
	if (existing) {
		return { existingSessionId: existing.id };
	}
	return null;
}

// ============================================
// Query helpers
// ============================================

/**
 * List baselines for a repo.
 */
export async function listBaselines(repoId: string, orgId: string): Promise<RepoBaselineRow[]> {
	return baselinesDb.listByRepo(repoId, orgId);
}

/**
 * List targets for a baseline.
 */
export async function listTargets(baselineId: string): Promise<RepoBaselineTargetRow[]> {
	return baselinesDb.listTargetsByBaseline(baselineId);
}

/**
 * Create a new baseline (status=validating).
 */
export async function createBaseline(input: {
	repoId: string;
	organizationId: string;
	version?: string;
	createdBy?: string;
	setupSessionId?: string;
}): Promise<RepoBaselineRow> {
	return baselinesDb.createBaseline(input);
}

/**
 * Create a target for a baseline.
 */
export async function createTarget(input: {
	repoBaselineId: string;
	name: string;
	description?: string;
	configJson?: unknown;
}): Promise<RepoBaselineTargetRow> {
	return baselinesDb.createTarget(input);
}

/**
 * Get active baselines for multiple repos (for list page).
 */
export async function getActiveBaselinesByRepoIds(
	repoIds: string[],
	orgId: string,
): Promise<RepoBaselineRow[]> {
	return baselinesDb.listActiveBaselinesByRepoIds(repoIds, orgId);
}

/**
 * Get the target count for a baseline.
 */
export async function getTargetCount(baselineId: string): Promise<number> {
	return baselinesDb.countTargetsByBaseline(baselineId);
}

/**
 * Get the latest setup session for a repo.
 */
export async function getLatestSetupSession(
	repoId: string,
	orgId: string,
): Promise<{ id: string; runtimeStatus: string; startedAt: Date | null } | null> {
	return baselinesDb.findLatestSetupSession(repoId, orgId);
}
