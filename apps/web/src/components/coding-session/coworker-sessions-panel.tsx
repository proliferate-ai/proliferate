"use client";

import { WorkerSessionsTab } from "@/components/automations/worker-sessions-tab";
import { LoadingDots } from "@/components/ui/loading-dots";
import type { WorkerSession } from "@/config/coworkers";
import { useWorkerSessions } from "@/hooks/automations/use-workers";
import { useMemo } from "react";

interface CoworkerSessionsPanelProps {
	workerId: string;
}

export function CoworkerSessionsPanel({ workerId }: CoworkerSessionsPanelProps) {
	const { data: rawSessions = [], isLoading } = useWorkerSessions(workerId, {
		pollingEnabled: true,
	});

	const sessions: WorkerSession[] = useMemo(
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

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto p-4">
			<WorkerSessionsTab sessions={sessions} isLoading={false} />
		</div>
	);
}
