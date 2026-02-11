/**
 * Automation runs DB operations.
 */

import {
	and,
	automationRunEvents,
	automationRuns,
	desc,
	eq,
	getDb,
	inArray,
	isNull,
	lt,
	or,
	sql,
} from "../db/client";
import type { InferSelectModel } from "../db/client";

export type AutomationRunRow = InferSelectModel<typeof automationRuns>;
export type AutomationRunEventRow = InferSelectModel<typeof automationRunEvents>;

export interface AutomationRunWithRelations extends AutomationRunRow {
	automation: {
		id: string;
		name: string;
		defaultPrebuildId: string | null;
		agentInstructions: string | null;
		modelId: string | null;
		notificationChannelId: string | null;
		notificationSlackInstallationId: string | null;
		enabledTools: unknown;
		llmFilterPrompt: string | null;
		llmAnalysisPrompt: string | null;
		allowAgenticRepoSelection: boolean | null;
	} | null;
	triggerEvent: {
		id: string;
		parsedContext: unknown;
		rawPayload: unknown;
		providerEventType: string | null;
		externalEventId: string | null;
		dedupKey: string | null;
	} | null;
	trigger: {
		id: string;
		provider: string;
		name: string | null;
	} | null;
}

export async function findById(runId: string): Promise<AutomationRunRow | null> {
	const db = getDb();
	const result = await db.query.automationRuns.findFirst({
		where: eq(automationRuns.id, runId),
	});
	return result ?? null;
}

export async function findByIdWithRelations(
	runId: string,
): Promise<AutomationRunWithRelations | null> {
	const db = getDb();
	const result = await db.query.automationRuns.findFirst({
		where: eq(automationRuns.id, runId),
		with: {
			automation: {
				columns: {
					id: true,
					name: true,
					defaultPrebuildId: true,
					agentInstructions: true,
					modelId: true,
					notificationChannelId: true,
					notificationSlackInstallationId: true,
					enabledTools: true,
					llmFilterPrompt: true,
					llmAnalysisPrompt: true,
					allowAgenticRepoSelection: true,
				},
			},
			triggerEvent: {
				columns: {
					id: true,
					parsedContext: true,
					rawPayload: true,
					providerEventType: true,
					externalEventId: true,
					dedupKey: true,
				},
			},
			trigger: {
				columns: {
					id: true,
					provider: true,
					name: true,
				},
			},
		},
	});

	return (result as AutomationRunWithRelations | null) ?? null;
}

export async function claimRun(
	runId: string,
	allowedStatuses: string[],
	leaseOwner: string,
	leaseTtlMs: number,
): Promise<AutomationRunRow | null> {
	const db = getDb();
	const now = new Date();
	const leaseExpiresAt = new Date(Date.now() + leaseTtlMs);

	const [row] = await db
		.update(automationRuns)
		.set({
			leaseOwner,
			leaseExpiresAt,
			leaseVersion: sql`${automationRuns.leaseVersion} + 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(automationRuns.id, runId),
				inArray(automationRuns.status, allowedStatuses),
				or(isNull(automationRuns.leaseExpiresAt), lt(automationRuns.leaseExpiresAt, now)),
			),
		)
		.returning();

	return row ?? null;
}

export async function updateRun(
	runId: string,
	updates: Partial<AutomationRunRow>,
): Promise<AutomationRunRow | null> {
	const db = getDb();
	const [row] = await db
		.update(automationRuns)
		.set({
			...updates,
			updatedAt: new Date(),
		})
		.where(eq(automationRuns.id, runId))
		.returning();
	return row ?? null;
}

export async function insertRunEvent(
	runId: string,
	type: string,
	fromStatus?: string | null,
	toStatus?: string | null,
	data?: Record<string, unknown> | null,
): Promise<AutomationRunEventRow> {
	const db = getDb();
	const [row] = await db
		.insert(automationRunEvents)
		.values({
			runId,
			type,
			fromStatus: fromStatus ?? null,
			toStatus: toStatus ?? null,
			data: data ?? null,
		})
		.returning();

	return row;
}

export async function listStaleRunningRuns(options: {
	limit?: number;
	inactivityMs: number;
	now?: Date;
}): Promise<AutomationRunRow[]> {
	const db = getDb();
	const now = options.now ?? new Date();
	const staleBefore = new Date(now.getTime() - options.inactivityMs);

	return db.query.automationRuns.findMany({
		where: and(
			eq(automationRuns.status, "running"),
			or(lt(automationRuns.deadlineAt, now), lt(automationRuns.lastActivityAt, staleBefore)),
		),
		limit: options.limit ?? 50,
	});
}

// ============================================
// Run listing & assignment
// ============================================

export interface RunListItem extends AutomationRunRow {
	triggerEvent: {
		id: string;
		parsedContext: unknown;
		providerEventType: string | null;
	} | null;
	trigger: {
		id: string;
		provider: string;
		name: string | null;
	} | null;
	session: {
		id: string;
		title: string | null;
		status: string;
	} | null;
	assignee: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	} | null;
}

export async function listRunsForAutomation(
	automationId: string,
	options: { status?: string; limit?: number; offset?: number } = {},
): Promise<{ runs: RunListItem[]; total: number }> {
	const db = getDb();
	const limit = Math.min(options.limit ?? 50, 100);
	const offset = options.offset ?? 0;

	const where = options.status
		? and(eq(automationRuns.automationId, automationId), eq(automationRuns.status, options.status))
		: eq(automationRuns.automationId, automationId);

	const [runs, countResult] = await Promise.all([
		db.query.automationRuns.findMany({
			where,
			with: {
				triggerEvent: {
					columns: {
						id: true,
						parsedContext: true,
						providerEventType: true,
					},
				},
				trigger: {
					columns: {
						id: true,
						provider: true,
						name: true,
					},
				},
				session: {
					columns: {
						id: true,
						title: true,
						status: true,
					},
				},
				assignee: {
					columns: {
						id: true,
						name: true,
						email: true,
						image: true,
					},
				},
			},
			orderBy: [desc(automationRuns.createdAt)],
			limit,
			offset,
		}),
		db.select({ count: sql<number>`count(*)::int` }).from(automationRuns).where(where),
	]);

	return {
		runs: runs as RunListItem[],
		total: countResult[0]?.count ?? 0,
	};
}

export async function assignRunToUser(
	runId: string,
	orgId: string,
	userId: string,
): Promise<AutomationRunRow | null> {
	const db = getDb();
	const [row] = await db
		.update(automationRuns)
		.set({
			assignedTo: userId,
			assignedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(automationRuns.id, runId),
				eq(automationRuns.organizationId, orgId),
				or(isNull(automationRuns.assignedTo), eq(automationRuns.assignedTo, userId)),
			),
		)
		.returning();
	return row ?? null;
}

export async function unassignRun(runId: string, orgId: string): Promise<AutomationRunRow | null> {
	const db = getDb();
	const [row] = await db
		.update(automationRuns)
		.set({
			assignedTo: null,
			assignedAt: null,
			updatedAt: new Date(),
		})
		.where(and(eq(automationRuns.id, runId), eq(automationRuns.organizationId, orgId)))
		.returning();
	return row ?? null;
}

export async function listRunsAssignedToUser(
	userId: string,
	orgId: string,
): Promise<RunListItem[]> {
	const db = getDb();

	const runs = await db.query.automationRuns.findMany({
		where: and(eq(automationRuns.assignedTo, userId), eq(automationRuns.organizationId, orgId)),
		with: {
			triggerEvent: {
				columns: {
					id: true,
					parsedContext: true,
					providerEventType: true,
				},
			},
			trigger: {
				columns: {
					id: true,
					provider: true,
					name: true,
				},
			},
			session: {
				columns: {
					id: true,
					title: true,
					status: true,
				},
			},
			assignee: {
				columns: {
					id: true,
					name: true,
					email: true,
					image: true,
				},
			},
		},
		orderBy: [desc(automationRuns.assignedAt)],
	});

	return runs as RunListItem[];
}
