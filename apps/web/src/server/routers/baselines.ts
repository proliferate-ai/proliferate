/**
 * Baselines oRPC router.
 *
 * Baseline lifecycle, target management, and setup session invariant.
 */

import { ORPCError } from "@orpc/server";
import { baselines } from "@proliferate/services";
import type { baselines as baselinesTypes } from "@proliferate/services";
import {
	RepoBaselineSchema,
	type RepoBaselineStatus,
	RepoBaselineTargetSchema,
} from "@proliferate/shared/contracts/baselines";
import { z } from "zod";
import { orgProcedure } from "./middleware";

function throwMappedBaselineError(error: unknown, internalMessage: string): never {
	if (error instanceof ORPCError) {
		throw error;
	}
	if (error instanceof baselines.BaselineNotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: error.message });
	}
	if (error instanceof baselines.BaselineTargetNotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: error.message });
	}
	if (error instanceof baselines.BaselineTargetMismatchError) {
		throw new ORPCError("BAD_REQUEST", { message: error.message });
	}
	if (error instanceof baselines.BaselineNoTargetsError) {
		throw new ORPCError("BAD_REQUEST", { message: error.message });
	}
	if (error instanceof baselines.BaselineInvalidTransitionError) {
		throw new ORPCError("BAD_REQUEST", { message: error.message });
	}
	if (error instanceof baselines.BaselineTransitionConflictError) {
		throw new ORPCError("CONFLICT", { message: error.message });
	}

	throw new ORPCError("INTERNAL_SERVER_ERROR", { message: internalMessage });
}

function toIso(d: Date | null | undefined): string | null {
	if (!d) return null;
	return d instanceof Date ? d.toISOString() : String(d);
}

type BaselineRow = baselinesTypes.RepoBaselineRow;
type TargetRow = baselinesTypes.RepoBaselineTargetRow;

function serializeBaseline(row: BaselineRow) {
	return {
		...row,
		status: row.status as RepoBaselineStatus,
		createdAt: toIso(row.createdAt),
		updatedAt: toIso(row.updatedAt),
	};
}

function serializeTarget(row: TargetRow) {
	return {
		...row,
		createdAt: toIso(row.createdAt),
	};
}

export const baselinesRouter = {
	/**
	 * Get active baseline for a repo.
	 */
	getActive: orgProcedure
		.input(z.object({ repoId: z.string().uuid() }))
		.output(z.object({ baseline: RepoBaselineSchema.nullable() }))
		.handler(async ({ input, context }) => {
			const row = await baselines
				.resolveActiveBaseline(input.repoId, context.orgId)
				.catch(() => null);
			return { baseline: row ? serializeBaseline(row) : null };
		}),

	/**
	 * List all baselines for a repo.
	 */
	list: orgProcedure
		.input(z.object({ repoId: z.string().uuid() }))
		.output(z.object({ baselines: z.array(RepoBaselineSchema) }))
		.handler(async ({ input, context }) => {
			const rows = await baselines.listBaselines(input.repoId, context.orgId);
			return { baselines: rows.map(serializeBaseline) };
		}),

	/**
	 * Get active baselines for multiple repos (for list page).
	 */
	listActiveByRepos: orgProcedure
		.input(z.object({ repoIds: z.array(z.string().uuid()) }))
		.output(z.object({ baselines: z.array(RepoBaselineSchema) }))
		.handler(async ({ input, context }) => {
			const rows = await baselines.getActiveBaselinesByRepoIds(input.repoIds, context.orgId);
			return { baselines: rows.map(serializeBaseline) };
		}),

	/**
	 * List targets for a baseline.
	 */
	listTargets: orgProcedure
		.input(z.object({ baselineId: z.string().uuid() }))
		.output(z.object({ targets: z.array(RepoBaselineTargetSchema) }))
		.handler(async ({ input }) => {
			const rows = await baselines.listTargets(input.baselineId);
			return { targets: rows.map(serializeTarget) };
		}),

	/**
	 * Get target count for a baseline.
	 */
	getTargetCount: orgProcedure
		.input(z.object({ baselineId: z.string().uuid() }))
		.output(z.object({ count: z.number() }))
		.handler(async ({ input }) => {
			const count = await baselines.getTargetCount(input.baselineId);
			return { count };
		}),

	/**
	 * Create a baseline (starts in validating status).
	 */
	create: orgProcedure
		.input(
			z.object({
				repoId: z.string().uuid(),
				version: z.string().optional(),
				setupSessionId: z.string().uuid().optional(),
			}),
		)
		.output(z.object({ baseline: RepoBaselineSchema }))
		.handler(async ({ input, context }) => {
			const row = await baselines.createBaseline({
				repoId: input.repoId,
				organizationId: context.orgId,
				version: input.version,
				createdBy: context.user.id,
				setupSessionId: input.setupSessionId,
			});
			return { baseline: serializeBaseline(row) };
		}),

	/**
	 * Create a target for a baseline.
	 */
	createTarget: orgProcedure
		.input(
			z.object({
				baselineId: z.string().uuid(),
				name: z.string().min(1).max(100),
				description: z.string().max(500).optional(),
			}),
		)
		.output(z.object({ target: RepoBaselineTargetSchema }))
		.handler(async ({ input }) => {
			const row = await baselines.createTarget({
				repoBaselineId: input.baselineId,
				name: input.name,
				description: input.description,
			});
			return { target: serializeTarget(row) };
		}),

	/**
	 * Mark baseline ready (validating → ready).
	 */
	markReady: orgProcedure
		.input(
			z.object({
				baselineId: z.string().uuid(),
				repoId: z.string().uuid(),
				version: z.string().optional(),
				snapshotId: z.string().optional(),
			}),
		)
		.output(z.object({ baseline: RepoBaselineSchema }))
		.handler(async ({ input, context }) => {
			try {
				const row = await baselines.markBaselineReady({
					baselineId: input.baselineId,
					orgId: context.orgId,
					repoId: input.repoId,
					fields: {
						version: input.version,
						snapshotId: input.snapshotId,
					},
				});
				return { baseline: serializeBaseline(row) };
			} catch (err) {
				throwMappedBaselineError(err, "Failed to mark baseline ready");
			}
		}),

	/**
	 * Mark baseline failed (validating → failed).
	 */
	markFailed: orgProcedure
		.input(
			z.object({
				baselineId: z.string().uuid(),
				errorMessage: z.string(),
			}),
		)
		.output(z.object({ baseline: RepoBaselineSchema }))
		.handler(async ({ input, context }) => {
			try {
				const row = await baselines.markBaselineFailed({
					baselineId: input.baselineId,
					orgId: context.orgId,
					errorMessage: input.errorMessage,
				});
				return { baseline: serializeBaseline(row) };
			} catch (err) {
				throwMappedBaselineError(err, "Failed to mark baseline failed");
			}
		}),

	/**
	 * Mark baseline stale (ready → stale).
	 */
	markStale: orgProcedure
		.input(z.object({ baselineId: z.string().uuid() }))
		.output(z.object({ baseline: RepoBaselineSchema }))
		.handler(async ({ input, context }) => {
			try {
				const row = await baselines.markBaselineStale({
					baselineId: input.baselineId,
					orgId: context.orgId,
				});
				return { baseline: serializeBaseline(row) };
			} catch (err) {
				throwMappedBaselineError(err, "Failed to mark baseline stale");
			}
		}),

	/**
	 * Restart validation (stale|failed|ready → validating).
	 */
	restartValidation: orgProcedure
		.input(
			z.object({
				baselineId: z.string().uuid(),
				fromStatus: z.enum(["stale", "failed", "ready"]),
				setupSessionId: z.string().uuid().optional(),
			}),
		)
		.output(z.object({ baseline: RepoBaselineSchema }))
		.handler(async ({ input, context }) => {
			try {
				const row = await baselines.restartValidation({
					baselineId: input.baselineId,
					orgId: context.orgId,
					fromStatus: input.fromStatus,
					setupSessionId: input.setupSessionId,
				});
				return { baseline: serializeBaseline(row) };
			} catch (err) {
				throwMappedBaselineError(err, "Failed to restart validation");
			}
		}),

	/**
	 * Check setup session invariant (at most one non-terminal setup session per repo).
	 */
	checkSetupInvariant: orgProcedure
		.input(z.object({ repoId: z.string().uuid() }))
		.output(z.object({ existingSessionId: z.string().nullable() }))
		.handler(async ({ input, context }) => {
			const result = await baselines.checkSetupSessionInvariant(input.repoId, context.orgId);
			return { existingSessionId: result?.existingSessionId ?? null };
		}),

	/**
	 * Get latest setup session for a repo.
	 */
	getLatestSetupSession: orgProcedure
		.input(z.object({ repoId: z.string().uuid() }))
		.output(
			z.object({
				session: z
					.object({
						id: z.string(),
						sandboxState: z.string(),
						agentState: z.string(),
						terminalState: z.string().nullable(),
						startedAt: z.string().nullable(),
					})
					.nullable(),
			}),
		)
		.handler(async ({ input, context }) => {
			const row = await baselines.getLatestSetupSession(input.repoId, context.orgId);
			if (!row) return { session: null };
			return {
				session: {
					id: row.id,
					sandboxState: row.sandboxState,
					agentState: row.agentState,
					terminalState: row.terminalState,
					startedAt: toIso(row.startedAt),
				},
			};
		}),
};
