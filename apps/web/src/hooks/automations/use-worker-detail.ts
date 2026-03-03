"use client";

import type {
	ChildSession,
	PendingDirective,
	WorkerRunWithEvents,
} from "@/components/automations/worker-activity-tab";
import type { WorkerSession } from "@/components/automations/worker-sessions-tab";
import {
	usePendingDirectives,
	useWorker,
	useWorkerRuns,
	useWorkerSessions,
} from "@/hooks/automations/use-workers";
import { useMemo } from "react";

export function useWorkerDetail(id: string) {
	const { data: worker, isLoading, error } = useWorker(id);

	const isWorkerActive = worker?.status === "active";

	const { data: runs = [], isLoading: isLoadingRuns } = useWorkerRuns(id, {
		limit: 10,
		pollingEnabled: isWorkerActive,
	});
	const { data: rawSessions = [], isLoading: isLoadingSessions } = useWorkerSessions(id, {
		pollingEnabled: isWorkerActive,
	});
	const { data: rawDirectives = [] } = usePendingDirectives(id);

	const mappedRuns: WorkerRunWithEvents[] = useMemo(
		() =>
			runs.map((run) => ({
				id: run.id,
				workerId: run.workerId,
				status: run.status,
				summary: run.summary,
				wakeEventId: run.wakeEventId,
				createdAt: run.createdAt.toISOString(),
				startedAt: run.startedAt?.toISOString() ?? null,
				completedAt: run.completedAt?.toISOString() ?? null,
				events: run.events.map((e) => ({
					id: e.id,
					eventIndex: e.eventIndex,
					eventType: e.eventType,
					summaryText: e.summaryText,
					payloadJson: e.payloadJson,
					sessionId: e.sessionId,
					actionInvocationId: e.actionInvocationId,
					createdAt: e.createdAt.toISOString(),
				})),
				childSessions: [] as ChildSession[],
			})),
		[runs],
	);

	const mappedSessions: WorkerSession[] = useMemo(
		() =>
			rawSessions.map((s) => ({
				id: s.id,
				title: s.title,
				status: s.status ?? "unknown",
				repoId: s.repoId,
				branchName: s.branchName,
				operatorStatus: s.operatorStatus,
				updatedAt: s.updatedAt?.toISOString() ?? new Date().toISOString(),
				startedAt: s.startedAt?.toISOString() ?? null,
			})),
		[rawSessions],
	);

	const mappedDirectives: PendingDirective[] = useMemo(
		() =>
			rawDirectives.map((d) => ({
				id: d.id,
				messageType: d.messageType,
				payloadJson: d.payloadJson,
				queuedAt: d.queuedAt.toISOString(),
				senderUserId: d.senderUserId,
			})),
		[rawDirectives],
	);

	const activeTaskCount = useMemo(
		() =>
			rawSessions.filter(
				(s) => s.status !== "completed" && s.status !== "failed" && s.status !== "cancelled",
			).length,
		[rawSessions],
	);

	return {
		worker,
		isLoading,
		error,
		runs: mappedRuns,
		sessions: mappedSessions,
		directives: mappedDirectives,
		activeTaskCount,
		isLoadingRuns,
		isLoadingSessions,
	};
}
