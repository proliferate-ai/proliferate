import { randomUUID } from "node:crypto";
import { env } from "@proliferate/environment/server";
import { afterEach, describe, expect, it } from "vitest";
import {
	and,
	eq,
	getDb,
	organization,
	repos,
	sessions,
	wakeEvents,
	workerRuns,
	workers,
} from "../db/client";
import { createWorker, createWorkerRun } from "./db";
import { orchestrateNextWakeAndCreateRun } from "./service";

const hasDatabaseUrl = typeof env.DATABASE_URL === "string" && env.DATABASE_URL.trim().length > 0;
const describeDb = hasDatabaseUrl ? describe : describe.skip;

const orgIdsToCleanup = new Set<string>();

async function cleanupOrganization(orgId: string): Promise<void> {
	const db = getDb();

	await db.delete(workers).where(eq(workers.organizationId, orgId));
	await db.delete(sessions).where(eq(sessions.organizationId, orgId));
	await db.delete(repos).where(eq(repos.organizationId, orgId));
	await db.delete(organization).where(eq(organization.id, orgId));
}

async function createWorkerFixture(): Promise<{
	organizationId: string;
	managerSessionId: string;
	workerId: string;
}> {
	const db = getDb();
	const suffix = randomUUID().replaceAll("-", "");
	const organizationId = `org_${suffix}`;

	orgIdsToCleanup.add(organizationId);

	await db.insert(organization).values({
		id: organizationId,
		name: `Org ${suffix}`,
		slug: `org-${suffix}`,
		createdAt: new Date(),
	});

	const [repo] = await db
		.insert(repos)
		.values({
			organizationId,
			githubUrl: `https://github.com/test/repo-${suffix}`,
			githubRepoId: `repo_${suffix}`,
			githubRepoName: `repo-${suffix}`,
		})
		.returning({ id: repos.id });

	const [managerSession] = await db
		.insert(sessions)
		.values({
			organizationId,
			repoId: repo.id,
			kind: "setup",
			runtimeStatus: "running",
			operatorStatus: "active",
			visibility: "private",
			status: "running",
		})
		.returning({ id: sessions.id });

	const worker = await createWorker({
		organizationId,
		name: `Worker ${suffix}`,
		managerSessionId: managerSession.id,
	});

	return {
		organizationId,
		managerSessionId: managerSession.id,
		workerId: worker.id,
	};
}

async function queueWake(input: {
	workerId: string;
	organizationId: string;
	source: "manual" | "manual_message" | "webhook" | "tick";
	createdAt: Date;
	payloadJson?: unknown;
}) {
	const db = getDb();
	const [wake] = await db
		.insert(wakeEvents)
		.values({
			workerId: input.workerId,
			organizationId: input.organizationId,
			source: input.source,
			status: "queued",
			createdAt: input.createdAt,
			payloadJson: input.payloadJson ?? null,
		})
		.returning();
	return wake;
}

describeDb("workers db orchestration (DB-backed)", () => {
	afterEach(async () => {
		for (const orgId of orgIdsToCleanup) {
			await cleanupOrganization(orgId);
		}
		orgIdsToCleanup.clear();
	});

	it("claims highest-priority queued wake and atomically creates run + wake_started event", async () => {
		const fixture = await createWorkerFixture();
		const now = Date.now();

		await queueWake({
			workerId: fixture.workerId,
			organizationId: fixture.organizationId,
			source: "tick",
			createdAt: new Date(now - 5_000),
		});
		await queueWake({
			workerId: fixture.workerId,
			organizationId: fixture.organizationId,
			source: "manual",
			createdAt: new Date(now - 3_000),
		});
		await queueWake({
			workerId: fixture.workerId,
			organizationId: fixture.organizationId,
			source: "webhook",
			createdAt: new Date(now - 4_000),
		});

		const result = await orchestrateNextWakeAndCreateRun(fixture.workerId, fixture.organizationId);
		expect(result).not.toBeNull();
		expect(result?.wakeEvent.source).toBe("manual");
		expect(result?.wakeEvent.status).toBe("consumed");
		expect(result?.wakeEvent.consumedAt).toBeInstanceOf(Date);
		expect(result?.workerRun.wakeEventId).toBe(result?.wakeEvent.id);
		expect(result?.wakeStartedEvent.workerRunId).toBe(result?.workerRun.id);
		expect(result?.wakeStartedEvent.eventType).toBe("wake_started");
		expect(result?.wakeStartedEvent.eventIndex).toBe(0);
		expect(result?.coalescedWakeEventIds).toEqual([]);
	});

	it("coalesces queued tick wakes into the claimed wake and preserves refs", async () => {
		const fixture = await createWorkerFixture();
		const now = Date.now();

		const claimedCandidate = await queueWake({
			workerId: fixture.workerId,
			organizationId: fixture.organizationId,
			source: "tick",
			createdAt: new Date(now - 5_000),
		});
		const coalescedOne = await queueWake({
			workerId: fixture.workerId,
			organizationId: fixture.organizationId,
			source: "tick",
			createdAt: new Date(now - 4_000),
		});
		const coalescedTwo = await queueWake({
			workerId: fixture.workerId,
			organizationId: fixture.organizationId,
			source: "tick",
			createdAt: new Date(now - 3_000),
		});

		const result = await orchestrateNextWakeAndCreateRun(fixture.workerId, fixture.organizationId);
		expect(result).not.toBeNull();
		expect(result?.wakeEvent.id).toBe(claimedCandidate.id);
		expect(result?.coalescedWakeEventIds.sort()).toEqual([coalescedOne.id, coalescedTwo.id].sort());

		const db = getDb();
		const coalescedRows = await db
			.select()
			.from(wakeEvents)
			.where(
				and(
					eq(wakeEvents.organizationId, fixture.organizationId),
					eq(wakeEvents.coalescedIntoWakeEventId, claimedCandidate.id),
				),
			);
		expect(coalescedRows).toHaveLength(2);
		for (const row of coalescedRows) {
			expect(row.status).toBe("coalesced");
		}
	});

	it("coalesces webhook wakes only when dedupe keys match", async () => {
		const fixture = await createWorkerFixture();
		const now = Date.now();

		const claimedCandidate = await queueWake({
			workerId: fixture.workerId,
			organizationId: fixture.organizationId,
			source: "webhook",
			createdAt: new Date(now - 6_000),
			payloadJson: { dedupeKey: "provider-event-1" },
		});
		const sameDedupe = await queueWake({
			workerId: fixture.workerId,
			organizationId: fixture.organizationId,
			source: "webhook",
			createdAt: new Date(now - 5_000),
			payloadJson: { dedupeKey: "provider-event-1" },
		});
		const differentDedupe = await queueWake({
			workerId: fixture.workerId,
			organizationId: fixture.organizationId,
			source: "webhook",
			createdAt: new Date(now - 4_000),
			payloadJson: { dedupeKey: "provider-event-2" },
		});

		const result = await orchestrateNextWakeAndCreateRun(fixture.workerId, fixture.organizationId);
		expect(result).not.toBeNull();
		expect(result?.wakeEvent.id).toBe(claimedCandidate.id);
		expect(result?.coalescedWakeEventIds).toEqual([sameDedupe.id]);

		const db = getDb();
		const [differentDedupeRow] = await db
			.select()
			.from(wakeEvents)
			.where(eq(wakeEvents.id, differentDedupe.id))
			.limit(1);
		expect(differentDedupeRow?.status).toBe("queued");
	});

	it("returns null when worker already has an active run and leaves queued wake untouched", async () => {
		const fixture = await createWorkerFixture();
		const now = Date.now();

		const queuedWake = await queueWake({
			workerId: fixture.workerId,
			organizationId: fixture.organizationId,
			source: "manual_message",
			createdAt: new Date(now - 2_000),
		});
		const historicalWake = await queueWake({
			workerId: fixture.workerId,
			organizationId: fixture.organizationId,
			source: "manual",
			createdAt: new Date(now - 10_000),
		});

		const activeRun = await createWorkerRun({
			workerId: fixture.workerId,
			organizationId: fixture.organizationId,
			managerSessionId: fixture.managerSessionId,
			wakeEventId: historicalWake.id,
		});

		const db = getDb();
		await db
			.update(workerRuns)
			.set({ status: "running", startedAt: new Date() })
			.where(eq(workerRuns.id, activeRun.id));

		const result = await orchestrateNextWakeAndCreateRun(fixture.workerId, fixture.organizationId);
		expect(result).toBeNull();

		const [unchangedWake] = await db
			.select()
			.from(wakeEvents)
			.where(eq(wakeEvents.id, queuedWake.id));
		expect(unchangedWake?.status).toBe("queued");
	});
});
