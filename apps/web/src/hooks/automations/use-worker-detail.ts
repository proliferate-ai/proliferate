"use client";

import type { WorkerSession } from "@/components/automations/worker-sessions-tab";
import { useWorker, useWorkerSessions } from "@/hooks/automations/use-workers";
import { useMemo } from "react";

export function useWorkerDetail(id: string) {
	const { data: worker, isLoading, error } = useWorker(id);

	const isWorkerActive = worker?.status === "active";

	const { data: rawSessions = [], isLoading: isLoadingSessions } = useWorkerSessions(id, {
		pollingEnabled: isWorkerActive,
	});

	const mappedSessions: WorkerSession[] = useMemo(
		() =>
			rawSessions.map((s) => ({
				id: s.id,
				title: s.title,
				status: s.status ?? "unknown",
				repoId: s.repoId,
				branchName: s.branchName,
				agentState: s.agentState,
				terminalState: s.terminalState,
				updatedAt: s.updatedAt?.toISOString() ?? new Date().toISOString(),
				startedAt: s.startedAt?.toISOString() ?? null,
			})),
		[rawSessions],
	);

	return {
		worker,
		isLoading,
		error,
		sessions: mappedSessions,
		isLoadingSessions,
	};
}
